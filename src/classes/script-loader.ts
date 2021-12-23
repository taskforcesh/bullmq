import { createHash } from 'crypto';
import * as minimatch from 'minimatch';
import * as commands from '../commands';
import * as includes from '../commands/includes';
import { RedisClient } from '../interfaces';

const IncludeRegex = /^[-]{2,3}[ \t]*@include[ \t]+(["'])(.+?)\1[; \t\n]*$/m;
const EmptyLineRegex = /^\s*[\r\n]/gm;

export interface Command {
  name: string;
  options: {
    numberOfKeys: number;
    lua: string;
  };
}

export interface RawInclude {
  content: string;
  name: string;
  path: string;
}

export type RawCommand = RawInclude & { keys: number };

/**
 * Script metadata
 */
export interface ScriptMetadata {
  /**
   * Name of the script
   */
  name: string;

  numberOfKeys?: number;
  /**
   * The path to the script. For includes, this is the normalized path,
   * whereas it may not be normalized for the top-level parent
   */
  path: string;
  /**
   * The raw script content
   */
  content: string;
  /**
   * A hash of the normalized path for easy replacement in the parent
   */
  token: string;
  /**
   * Metadata on the scripts that this script includes
   */
  includes: ScriptMetadata[];
}

export class ScriptLoaderError extends Error {
  public readonly path: string;
  /**
   * The include stack
   */
  public readonly includes: string[];
  public readonly line: number;
  public readonly position: number;

  constructor(
    message: string,
    path: string,
    stack: string[] = [],
    line?: number,
    position = 0,
  ) {
    super(message);
    // Ensure the name of this error is the same as the class name
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
    this.includes = stack;
    this.line = line ?? 0;
    this.position = position;
  }
}

/**
 * Lua script loader with include support
 */
export class ScriptLoader {
  /**
   * Cache commands by dir
   */
  private commandCache: Command[]; // = new Map<string, Command[]>();
  private cache = new Map<string, ScriptMetadata>();

  /**
   * Recursively collect all scripts included in a file
   * @param file - the parent file
   * @param cache - a cache for file metadata to increase efficiency. Since a file can be included
   * multiple times, we make sure to load it only once.
   * @param stack - internal stack to prevent circular references
   */
  private resolveDependencies(
    file: ScriptMetadata,
    includes: Map<string, RawInclude>,
    stack: string[] = [],
  ): void {
    if (stack.includes(file.path)) {
      throw new ScriptLoaderError(
        `circular reference: "${file.path}"`,
        file.path,
        stack,
      );
    }
    stack.push(file.path);

    function findPos(content: string, match: string) {
      const pos = content.indexOf(match);
      const arr = content.slice(0, pos).split('\n');
      return {
        line: arr.length,
        column: arr[arr.length - 1].length + match.indexOf('@include') + 1,
      };
    }

    function raiseError(msg: string, match: string): void {
      const pos = findPos(file.content, match);
      throw new ScriptLoaderError(msg, file.path, stack, pos.line, pos.column);
    }

    let res;
    let content = file.content;

    while ((res = IncludeRegex.exec(content)) !== null) {
      const [match, , reference] = res;

      let includeMatches: string[];
      if (!includes.get(reference)) {
        includeMatches = getFilenamesByPatternSync(reference, includes);
      } else {
        includeMatches = [reference];
      }

      if (includeMatches.length === 0) {
        raiseError(`include not found: "${reference}"`, match);
      }

      const tokens: string[] = [];

      for (let i = 0; i < includeMatches.length; i++) {
        const includeMatch = includeMatches[i];

        const hasInclude = file.includes.find(
          (x: ScriptMetadata) => x.path === includeMatch,
        );

        if (hasInclude) {
          /**
           * We have something like
           * --- \@include "a"
           * ...
           * --- \@include "a"
           */
          raiseError(
            `file "${reference}" already included in "${file.path}"`,
            match,
          );
        }

        let includeMetadata = this.cache.get(includeMatch);
        let token: string;

        if (!includeMetadata) {
          const include = includes.get(includeMatch);
          if (!include) {
            raiseError(`include not found: "${reference}"`, match);
          }
          // this represents a normalized version of the path to make replacement easy
          token = getPathHash(includeMatch);
          includeMetadata = {
            name: include.name,
            numberOfKeys: 0,
            path: include.path,
            content: include.content,
            token,
            includes: [],
          };
          this.cache.set(includeMatch, includeMetadata);
        } else {
          token = includeMetadata.token;
        }

        tokens.push(token);

        file.includes.push(includeMetadata);
        this.resolveDependencies(includeMetadata, includes, stack);
      }

      // Replace @includes with normalized path hashes
      const substitution = tokens.join('\n');
      content = content.replace(match, substitution);
    }

    file.content = content;
    this.cache.set(file.path, file);

    stack.pop();
  }

  /**
   * Parse a (top-level) lua script
   * @param filename - the full path to the script
   * @param content - the content of the script
   * @param cache - cache
   */
  parseScript(
    filename: string,
    command: RawCommand,
    includes: Map<string, RawInclude>,
  ): ScriptMetadata {
    const meta = this.cache?.get(filename);
    if (meta?.content === command.content) {
      return meta;
    }
    const fileInfo: ScriptMetadata = {
      path: filename,
      token: getPathHash(filename),
      content: command.content,
      name: filename,
      numberOfKeys: command.keys,
      includes: [],
    };

    this.resolveDependencies(fileInfo, includes);
    return fileInfo;
  }

  /**
   * Construct the final version of a file by interpolating its includes in dependency order.
   * @param file - the file whose content we want to construct
   * @param processed - a cache to keep track of which includes have already been processed
   */
  interpolate(file: ScriptMetadata, processed?: Set<string>): string {
    processed = processed || new Set<string>();
    let content = file.content;
    file.includes.forEach((child: ScriptMetadata) => {
      const emitted = processed.has(child.path);
      const fragment = this.interpolate(child, processed);
      const replacement = emitted ? '' : fragment;

      if (!replacement) {
        content = replaceAll(content, child.token, '');
      } else {
        // replace the first instance with the dependency
        content = content.replace(child.token, replacement);
        // remove the rest
        content = replaceAll(content, child.token, '');
      }

      processed.add(child.path);
    });

    return content;
  }

  loadCommand(
    commandName: string,
    command: RawCommand,
    includes: Map<string, RawInclude> = new Map(),
  ): Command {
    const script = this.parseScript(commandName, command, includes);

    const lua = removeEmptyLines(this.interpolate(script));
    const { name, numberOfKeys } = script;

    return {
      name,
      options: { numberOfKeys, lua },
    };
  }

  /**
   * Load redis lua scripts.
   * The name of the script must have the following format:
   *
   * cmdName-numKeys.lua
   *
   * cmdName must be in camel case format.
   *
   * For example:
   * moveToFinish-3.lua
   *
   */
  loadScripts(
    extraCommands: Record<string, RawCommand> = {},
    extraIncludes: Record<string, RawInclude> = {},
  ): Command[] {
    if (this.commandCache) {
      return this.commandCache;
    }
    const mapAllCommands = new Map<string, RawCommand>();
    const mapAllIncludes = new Map<string, RawInclude>();

    const scripts: Command[] = [];
    for (const property in commands) {
      mapAllCommands.set(
        (commands as any)[property].path,
        (commands as any)[property],
      );
    }
    for (const property in extraCommands) {
      mapAllCommands.set(extraCommands[property].path, extraCommands[property]);
    }
    for (const property in includes) {
      mapAllIncludes.set(
        (includes as any)[property].path,
        (includes as any)[property],
      );
    }
    for (const property in extraIncludes) {
      mapAllIncludes.set(extraIncludes[property].path, extraIncludes[property]);
    }
    mapAllCommands.forEach((value, key) => {
      const command = this.loadCommand(key, value, mapAllIncludes);
      scripts.push(command);
    });

    this.commandCache = scripts;

    return scripts;
  }

  /**
   * Attach all lua scripts in a given directory to a client instance
   * @param client - redis client to attach script to
   * @param pathname - the path to the directory containing the scripts
   */
  load(
    client: RedisClient,
    extraCommands?: Record<string, RawCommand>,
    extraIncludes?: Record<string, RawInclude>,
  ): void {
    const scripts = this.loadScripts(extraCommands, extraIncludes);
    scripts.forEach((command: Command) => {
      // Only define the command if not already defined
      if (!(client as any)[command.name]) {
        client.defineCommand(command.name, command.options);
      }
    });
  }

  /**
   * Clears the command cache
   */
  clearCache(): void {
    this.commandCache = undefined;
    this.cache.clear();
  }
}

function getFilenamesByPatternSync(
  pattern: string,
  includes: Map<string, RawInclude>,
): string[] {
  const filenames: string[] = [];
  includes.forEach((value, key) => {
    if (minimatch(key, pattern)) {
      filenames.push(key);
    }
  });
  return filenames;
}

function sha1(data: string): string {
  return createHash('sha1').update(data).digest('hex');
}

function getPathHash(normalizedPath: string): string {
  return `@@${sha1(normalizedPath)}`;
}

function replaceAll(str: string, find: string, replace: string): string {
  return str.replace(new RegExp(find, 'g'), replace);
}

function removeEmptyLines(str: string): string {
  return str.replace(EmptyLineRegex, '');
}

export const scriptLoader = new ScriptLoader();
