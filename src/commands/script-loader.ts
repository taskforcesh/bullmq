import { createHash } from 'crypto';
import { glob, hasMagic } from 'glob';
import * as path from 'path';
import * as fs from 'fs';
import { RedisClient } from '../interfaces';
import { promisify } from 'util';

const readFile = promisify(fs.readFile);
const readdir = promisify(fs.readdir);

const GlobOptions = { dot: true, silent: false };
const IncludeRegex = /^[-]{2,3}[ \t]*@include[ \t]+(["'])(.+?)\1[; \t\n]*$/m;
const EmptyLineRegex = /^\s*[\r\n]/gm;

export interface Command {
  name: string;
  options: {
    numberOfKeys: number;
    lua: string;
  };
}

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

const isPossiblyMappedPath = (path: string) =>
  path && ['~', '<'].includes(path[0]);
const hasFilenamePattern = (path: string) => hasMagic(path, GlobOptions);

/**
 * Lua script loader with include support
 */
export class ScriptLoader {
  /**
   * Map an alias to a path
   */
  private pathMapper = new Map<string, string>();
  private clientScripts = new WeakMap<RedisClient, Set<string>>();
  /**
   * Cache commands by dir
   */
  private commandCache = new Map<string, Command[]>();
  private rootPath: string;

  constructor() {
    this.rootPath = getPkgJsonDir();
    this.pathMapper.set('~', this.rootPath);
    this.pathMapper.set('rootDir', this.rootPath);
    this.pathMapper.set('base', __dirname);
  }

  /**
   * Add a script path mapping. Allows includes of the form "<includes>/utils.lua" where `includes` is a user
   * defined path
   * @param name - the name of the mapping. Note: do not include angle brackets
   * @param mappedPath - if a relative path is passed, it's relative to the *caller* of this function.
   * Mapped paths are also accepted, e.g. "~/server/scripts/lua" or "<base>/includes"
   */
  addPathMapping(name: string, mappedPath: string): void {
    let resolved: string;

    if (isPossiblyMappedPath(mappedPath)) {
      resolved = this.resolvePath(mappedPath);
    } else {
      const caller = getCallerFile();
      const callerPath = path.dirname(caller);
      resolved = path.normalize(path.resolve(callerPath, mappedPath));
    }

    const last = resolved.length - 1;
    if (resolved[last] === path.sep) {
      resolved = resolved.substr(0, last);
    }

    this.pathMapper.set(name, resolved);
  }

  /**
   * Resolve the script path considering path mappings
   * @param scriptName - the name of the script
   * @param stack - the include stack, for nicer errors
   */
  resolvePath(scriptName: string, stack: string[] = []): string {
    const first = scriptName[0];
    if (first === '~') {
      scriptName = path.join(this.rootPath, scriptName.substr(2));
    } else if (first === '<') {
      const p = scriptName.indexOf('>');
      if (p > 0) {
        const name = scriptName.substring(1, p);
        const mappedPath = this.pathMapper.get(name);
        if (!mappedPath) {
          throw new ScriptLoaderError(
            `No path mapping found for "${name}"`,
            scriptName,
            stack,
          );
        }
        scriptName = path.join(mappedPath, scriptName.substring(p + 1));
      }
    }

    return path.normalize(scriptName);
  }

  /**
   * Recursively collect all scripts included in a file
   * @param file - the parent file
   * @param cache - a cache for file metadata to increase efficiency. Since a file can be included
   * multiple times, we make sure to load it only once.
   * @param stack - internal stack to prevent circular references
   */
  private async resolveDependencies(
    file: ScriptMetadata,
    cache?: Map<string, ScriptMetadata>,
    stack: string[] = [],
  ): Promise<void> {
    cache = cache ?? new Map<string, ScriptMetadata>();

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

      const includeFilename = isPossiblyMappedPath(reference)
        ? // mapped paths imply absolute reference
          this.resolvePath(ensureExt(reference), stack)
        : // include path is relative to the file being processed
          path.resolve(path.dirname(file.path), ensureExt(reference));

      let includePaths: string[];

      if (hasFilenamePattern(includeFilename)) {
        const filesMatched = await getFilenamesByPattern(includeFilename);
        includePaths = filesMatched.map((x: string) => path.resolve(x));
      } else {
        includePaths = [includeFilename];
      }

      includePaths = includePaths.filter(
        (file: string) => path.extname(file) === '.lua',
      );

      if (includePaths.length === 0) {
        raiseError(`include not found: "${reference}"`, match);
      }

      const tokens: string[] = [];

      for (let i = 0; i < includePaths.length; i++) {
        const includePath = includePaths[i];

        const hasInclude = file.includes.find(
          (x: ScriptMetadata) => x.path === includePath,
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

        let includeMetadata = cache.get(includePath);
        let token: string;

        if (!includeMetadata) {
          const { name, numberOfKeys } = splitFilename(includePath);
          let childContent: string;
          try {
            const buf = await readFile(includePath, { flag: 'r' });
            childContent = buf.toString();
          } catch (err) {
            if ((err as any).code === 'ENOENT') {
              raiseError(`include not found: "${reference}"`, match);
            } else {
              throw err;
            }
          }
          // this represents a normalized version of the path to make replacement easy
          token = getPathHash(includePath);
          includeMetadata = {
            name,
            numberOfKeys,
            path: includePath,
            content: childContent,
            token,
            includes: [],
          };
          cache.set(includePath, includeMetadata);
        } else {
          token = includeMetadata.token;
        }

        tokens.push(token);

        file.includes.push(includeMetadata);
        await this.resolveDependencies(includeMetadata, cache, stack);
      }

      // Replace @includes with normalized path hashes
      const substitution = tokens.join('\n');
      content = content.replace(match, substitution);
    }

    file.content = content;
    cache.set(file.path, file);

    stack.pop();
  }

  /**
   * Parse a (top-level) lua script
   * @param filename - the full path to the script
   * @param content - the content of the script
   * @param cache - cache
   */
  async parseScript(
    filename: string,
    content: string,
    cache?: Map<string, ScriptMetadata>,
  ): Promise<ScriptMetadata> {
    const meta = cache?.get(filename);
    if (meta?.content === content) {
      return meta;
    }
    const { name, numberOfKeys } = splitFilename(filename);
    const fileInfo: ScriptMetadata = {
      path: filename,
      token: getPathHash(filename),
      content,
      name,
      numberOfKeys,
      includes: [],
    };

    await this.resolveDependencies(fileInfo, cache);
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

  async loadCommand(
    filename: string,
    cache?: Map<string, ScriptMetadata>,
  ): Promise<Command> {
    filename = path.resolve(filename);

    let script = cache?.get(filename);
    if (!script) {
      const content = (await readFile(filename)).toString();
      script = await this.parseScript(filename, content, cache);
    }

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
  async loadScripts(
    dir?: string,
    cache?: Map<string, ScriptMetadata>,
  ): Promise<Command[]> {
    dir = path.normalize(dir || __dirname);

    let commands = this.commandCache.get(dir);
    if (commands) {
      return commands;
    }

    const files = await readdir(dir);

    const luaFiles = files.filter(
      (file: string) => path.extname(file) === '.lua',
    );

    if (luaFiles.length === 0) {
      /**
       * To prevent unclarified runtime error "updateDelayset is not a function
       * @see https://github.com/OptimalBits/bull/issues/920
       */
      throw new ScriptLoaderError('No .lua files found!', dir, []);
    }

    commands = [];
    cache = cache ?? new Map<string, ScriptMetadata>();

    for (let i = 0; i < luaFiles.length; i++) {
      const file = path.join(dir, luaFiles[i]);

      const command = await this.loadCommand(file, cache);
      commands.push(command);
    }

    this.commandCache.set(dir, commands);

    return commands;
  }

  /**
   * Attach all lua scripts in a given directory to a client instance
   * @param client - redis client to attach script to
   * @param pathname - the path to the directory containing the scripts
   */
  async load(client: RedisClient, pathname: string): Promise<void> {
    let paths: Set<string> = this.clientScripts.get(client);
    if (!paths) {
      paths = new Set<string>();
      this.clientScripts.set(client, paths);
    }
    if (!paths.has(pathname)) {
      paths.add(pathname);
      const scripts = await this.loadScripts(pathname);
      scripts.forEach((command: Command) => {
        // Only define the command if not already defined
        if (!(client as any)[command.name]) {
          client.defineCommand(command.name, command.options);
        }
      });
    }
  }

  /**
   * Clears the command cache
   */
  clearCache(): void {
    this.commandCache.clear();
  }
}

function ensureExt(filename: string, ext = 'lua'): string {
  const foundExt = path.extname(filename);
  if (foundExt && foundExt !== '.') {
    return filename;
  }
  if (ext && ext[0] !== '.') {
    ext = `.${ext}`;
  }
  return `${filename}${ext}`;
}

function splitFilename(filePath: string): {
  name: string;
  numberOfKeys?: number;
} {
  const longName = path.basename(filePath, '.lua');
  const [name, num] = longName.split('-');
  const numberOfKeys = num && parseInt(num, 10);
  return { name, numberOfKeys };
}

async function getFilenamesByPattern(pattern: string): Promise<string[]> {
  return new Promise<string[]>((resolve, reject) => {
    glob(pattern, GlobOptions, (err, files) => {
      return err ? reject(err) : resolve(files);
    });
  });
}

// Determine the project root
// https://stackoverflow.com/a/18721515
function getPkgJsonDir(): string {
  for (const modPath of module.paths || []) {
    try {
      const prospectivePkgJsonDir = path.dirname(modPath);
      fs.accessSync(modPath, fs.constants.F_OK);
      return prospectivePkgJsonDir;
      // eslint-disable-next-line no-empty
    } catch (e) {}
  }
}

// https://stackoverflow.com/a/66842927
// some dark magic here :-)
// this version is preferred to the simpler version because of
// https://github.com/facebook/jest/issues/5303 -
// tldr: dont assume you're the only one with the doing something like this
function getCallerFile() {
  const originalFunc = Error.prepareStackTrace;

  let callerFile;
  try {
    Error.prepareStackTrace = (_, stack) => stack;

    const sites = <NodeJS.CallSite[]>(<unknown>new Error().stack);
    const currentFile = sites.shift().getFileName();

    while (sites.length) {
      callerFile = sites.shift().getFileName();

      if (currentFile !== callerFile) {
        break;
      }
    }
    // eslint-disable-next-line no-empty
  } catch (e) {
  } finally {
    Error.prepareStackTrace = originalFunc;
  }

  return callerFile;
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
