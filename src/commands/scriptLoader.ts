import { RedisClient } from '../classes';
import { createHash } from 'crypto';
import { glob, hasMagic } from 'glob';
import * as path from 'path';
import * as fs from 'fs';
import { promisify } from 'util';
import CallSite = NodeJS.CallSite;

const readFile = promisify(fs.readFile);
const readdir = promisify(fs.readdir);

const GLOB_OPTS = { dot: true, silent: false };
const RE_INCLUDE = /^[-]{2,3}[ \t]*@include[ \t]+(["'])(.+?)\1[; \t\n]*$/m;
const RE_EMPTY_LINE = /^\s*[\r\n]/gm;

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
export interface ScriptInfo {
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
  includes: ScriptInfo[];
}

export class ScriptLoaderError extends Error {
  public path: string;
  public includes: string[];
  public line: number;
  public position: number;

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

const pathMapper = new Map<string, string>();
let rootPath: string;

// Determine the project root
// https://stackoverflow.com/a/18721515
export function getPkgJsonDir(): string {
  for (const modPath of module.paths) {
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
function _getCallerFile() {
  const originalFunc = Error.prepareStackTrace;

  let callerFile;
  try {
    const err = new Error();
    Error.prepareStackTrace = function(err, stack) {
      return stack;
    };

    const sites = <CallSite[]>(<unknown>err.stack);
    const currentFile = sites.shift().getFileName();

    while (err.stack.length) {
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

function initMapping() {
  if (!rootPath) {
    rootPath = getPkgJsonDir();
    pathMapper.set('~', rootPath);
    pathMapper.set('rootDir', rootPath);
    pathMapper.set('base', __dirname);
  }
}

const possiblyMapped = (path: string) => path && ['~', '<'].includes(path[0]);
const isGlob = (path: string) => hasMagic(path, GLOB_OPTS);

/**
 * Add a script path mapping. Allows includes of the form "<includes>/utils.lua" where `includes` is a user
 * defined path
 * @param name - the name of the mapping. Note: do not include angle brackets
 * @param mappedPath - if a relative path is passed, it's relative to the *caller* of this function.
 * Mapped paths are also accepted, e.g. "~/server/scripts/lua" or "<base>/includes"
 */
export function addScriptPathMapping(name: string, mappedPath: string): void {
  initMapping();
  let resolved: string;

  if (possiblyMapped(mappedPath)) {
    resolved = resolvePath(mappedPath);
  } else {
    const caller = _getCallerFile();
    const callerPath = path.dirname(caller);
    resolved = path.normalize(path.resolve(callerPath, mappedPath));
  }

  if (resolved[resolved.length - 1] === path.sep) {
    resolved = resolved.substr(0, resolved.length - 1);
  }

  pathMapper.set(name, resolved);
}

/**
 * Resolve the script path considering path mappings
 * @param scriptName - the name of the script
 * @param stack - the include stack, for nicer errors
 */
export function resolvePath(scriptName: string, stack: string[] = []): string {
  const first = scriptName[0];
  if (first === '~') {
    scriptName = path.join(rootPath, scriptName.substr(2));
  } else if (first === '<') {
    const p = scriptName.indexOf('>');
    if (p > 0) {
      const name = scriptName.substring(1, p);
      const mappedPath = pathMapper.get(name);
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

function calcSha1(data: string): string {
  return createHash('sha1').update(data).digest('hex');
}

function getReplacementToken(normalizedPath: string): string {
  return `--- @${calcSha1(normalizedPath)}`;
}

function bannerize(fileName: string, baseDir: string, content: string): string {
  if (!content) {
    return '';
  }
  let name = fileName.substr(baseDir.length);
  if (name[0] == path.sep) {
    name = name.substr(1);
  }
  const header = '---[START ' + name + ' ]---';
  const footer = '---[END   ' + name + ' ]---';
  return `${header}\n${content}\n${footer}`;
}

function findPos(content: string, match: string) {
  const pos = content.indexOf(match);
  const arr = content.slice(0, pos).split('\n');
  return {
    line: arr.length,
    column: arr[arr.length - 1].length + match.indexOf('@include') + 1,
  };
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

async function handleGlob(pattern: string): Promise<string[]> {
  return new Promise<string[]>((resolve, reject) => {
    glob(pattern, GLOB_OPTS, (err, files) => {
      return err ? reject(err) : resolve(files);
    });
  });
}

/**
 * Recursively collect all scripts included in a file
 * @param file - the parent file
 * @param cache - a cache for file metadata to increase efficiency. Since a file can be included
 * multiple times, we make sure to load it only once.
 * @param stack - internal stack to prevent circular references
 */
async function collectFilesInternal(
  file: ScriptInfo,
  cache: Map<string, ScriptInfo>,
  stack: string[],
): Promise<void> {
  if (stack.includes(file.path)) {
    throw new ScriptLoaderError(
      `circular reference: "${file.path}"`,
      file.path,
      stack,
    );
  }
  stack.push(file.path);

  function raiseError(msg: string, match: string): void {
    const pos = findPos(file.content, match);
    throw new ScriptLoaderError(msg, file.path, stack, pos.line, pos.column);
  }

  let res;
  let content = file.content;

  while ((res = RE_INCLUDE.exec(content)) !== null) {
    const [match, , reference] = res;

    const pattern = possiblyMapped(reference)
      ? resolvePath(ensureExt(reference), stack)
      : path.resolve(path.dirname(file.path), ensureExt(reference));

    let refPaths: string[];

    if (isGlob(pattern)) {
      const globbed = await handleGlob(pattern);
      refPaths = globbed.map((x: string) => path.resolve(x));
    } else {
      refPaths = [pattern];
    }

    refPaths = refPaths.filter((file: string) => path.extname(file) === '.lua');

    if (refPaths.length === 0) {
      raiseError(`include not found: "${reference}"`, match);
    }

    const tokens: string[] = [];

    for (let i = 0; i < refPaths.length; i++) {
      const path = refPaths[i];

      const hasDependent = file.includes.find(
        (x: ScriptInfo) => x.path === path,
      );

      if (hasDependent) {
        raiseError(
          `file "${reference}" already included in "${file.path}"`,
          match,
        );
      }

      let dependent = cache.get(path);
      let token: string;

      if (!dependent) {
        const { name, numberOfKeys } = splitFilename(path);
        let childContent: string;
        try {
          const buf = await readFile(path, { flag: 'r' });
          childContent = buf.toString();
          childContent = childContent.replace(RE_EMPTY_LINE, '');
        } catch (err) {
          if ((err as any).code === 'ENOENT') {
            raiseError(`include not found: "${reference}"`, match);
          } else {
            throw err;
          }
        }
        // this represents a normalized version of the path to make replacement easy
        token = getReplacementToken(path);
        dependent = {
          name,
          numberOfKeys,
          path,
          content: childContent,
          token,
          includes: [],
        };
        cache.set(path, dependent);
      } else {
        token = dependent.token;
      }

      tokens.push(token);

      file.includes.push(dependent);
      await collectFilesInternal(dependent, cache, stack);
    }

    const substitution = tokens.join('\n');
    content = content.replace(match, substitution);
  }

  file.content = content;
  cache.set(file.path, file);

  stack.pop();
}

async function collectFiles(file: ScriptInfo, cache: Map<string, ScriptInfo>) {
  initMapping();
  return collectFilesInternal(file, cache, []);
}

/**
 * Construct the final version of a file by interpolating its includes in dependency order.
 * @param file - the file whose content we want to construct
 * @param baseDir - the base directory of the file. Used only to massage the filename for the banner
 * @param cache - a cache to keep track of which includes have already been processed
 */
function mergeInternal(
  file: ScriptInfo,
  baseDir: string,
  cache?: Set<string>,
): string {
  cache = cache || new Set<string>();
  let content = file.content;
  file.includes.forEach((dependent: ScriptInfo) => {
    const emitted = cache.has(dependent.path);
    const fragment = mergeInternal(dependent, baseDir, cache);
    const replacement =
      emitted || !fragment ? '' : bannerize(dependent.path, baseDir, fragment);

    if (!replacement) {
      content = content.replaceAll(dependent.token, '');
    } else {
      // replace the first instance with the dependency
      content = content.replace(dependent.token, replacement);
      // remove the rest
      content = content.replaceAll(dependent.token, '');
    }

    cache.add(dependent.path);
  });

  return content;
}

function getFullDirname(filename: string): string {
  const parts = filename.split(path.sep);
  return parts.splice(0, parts.length - 1).join(path.sep);
}

export async function processScript(
  filename: string,
  content: string,
  cache?: Map<string, ScriptInfo>,
): Promise<string> {
  cache = cache ?? new Map<string, ScriptInfo>();
  const { name, numberOfKeys } = splitFilename(filename);
  const fileInfo: ScriptInfo = {
    path: filename,
    token: '',
    content,
    name,
    numberOfKeys,
    includes: [],
  };

  await collectFiles(fileInfo, cache);
  const baseDir = getFullDirname(filename);
  return mergeInternal(fileInfo, baseDir);
}

export async function loadScript(
  filename: string,
  cache?: Map<string, ScriptInfo>,
): Promise<string> {
  filename = path.normalize(filename);
  const buf = await readFile(filename);
  const content = buf.toString();
  return processScript(filename, content, cache);
}

async function _loadCommand(
  filePath: string,
  cache?: Map<string, ScriptInfo>,
): Promise<Command> {
  const { name, numberOfKeys } = splitFilename(filePath);
  const content = await loadScript(filePath, cache);

  return {
    name,
    options: { numberOfKeys, lua: content },
  };
}

export async function loadCommand(filePath: string): Promise<Command> {
  const cache = new Map<string, ScriptInfo>();
  return _loadCommand(filePath, cache);
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
export async function loadScripts(
  dir?: string,
  cache?: Map<string, ScriptInfo>,
): Promise<Command[]> {
  dir = dir || __dirname;
  const files = await readdir(dir);

  const luaFiles = files.filter(
    (file: string) => path.extname(file) === '.lua',
  );

  if (luaFiles.length === 0) {
    /**
     * To prevent unclarified runtime error "updateDelayset is not a function
     * @see https://github.com/OptimalBits/bull/issues/920
     */
    throw new Error('No .lua files found!');
  }

  const commands: Command[] = [];
  cache = cache ?? new Map<string, ScriptInfo>();

  for (let i = 0; i < luaFiles.length; i++) {
    const file = path.join(dir, luaFiles[i]);
    const command = await _loadCommand(file, cache);
    commands.push(command);
  }

  return commands;
}

const clientPaths = new WeakMap<RedisClient, Set<string>>();

export const load = async function(
  client: RedisClient,
  pathname: string,
  cache?: Map<string, ScriptInfo>,
): Promise<void> {
  let paths: Set<string> = clientPaths.get(client);
  if (!paths) {
    paths = new Set<string>();
    clientPaths.set(client, paths);
  }
  if (!paths.has(pathname)) {
    paths.add(pathname);

    const scripts = await loadScripts(pathname, cache);
    scripts.forEach((command: Command) => {
      // Only define the command if not already defined
      if (!(client as any)[command.name]) {
        client.defineCommand(command.name, command.options);
      }
    });
  }
};
