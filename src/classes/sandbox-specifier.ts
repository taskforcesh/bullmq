import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * URL scheme (`file:`, `data:`, `node:`, …). One letter is excluded so a
 * Windows drive (`D:`) is not treated as a scheme.
 */
const URL_SCHEME = /^[a-zA-Z][a-zA-Z\d+.-]+:/;

/**
 * Converts a sandboxed processor path into a specifier `import()` accepts.
 *
 * Absolute filesystem paths become file URLs. On Windows,
 * `import("D:\\proj\\worker.js")` throws `ERR_UNSUPPORTED_ESM_URL_SCHEME`
 * because the drive letter is parsed as a URL protocol. Specifiers that
 * already have a URL scheme, and relative paths used by existing CommonJS
 * processors, are returned unchanged.
 *
 * Windows drive and UNC paths are recognized with `path.win32`, so the
 * conversion can be unit tested on POSIX.
 *
 * @param processorFile - Processor filesystem path or URL string.
 * @returns A module specifier safe to pass to dynamic `import()`.
 */
export function toSandboxImportSpecifier(processorFile: string): string {
  if (isUrlSpecifier(processorFile)) {
    return processorFile;
  }

  // Drive-letter and UNC paths are absolute on Windows only.
  if (
    path.win32.isAbsolute(processorFile) &&
    !path.posix.isAbsolute(processorFile)
  ) {
    return windowsPathToFileURL(processorFile);
  }

  if (path.isAbsolute(processorFile)) {
    return pathToFileURL(processorFile).href;
  }

  return processorFile;
}

function isUrlSpecifier(specifier: string): boolean {
  return URL_SCHEME.test(specifier);
}

/**
 * `pathToFileURL` follows the host platform. On Windows that already yields a
 * `file://` URL. Off Windows, pass `{ windows: true }` (Node 20+) so a
 * Windows absolute path is not resolved against the POSIX cwd.
 *
 * @param processorFile - Windows absolute path.
 */
function windowsPathToFileURL(processorFile: string): string {
  if (process.platform === 'win32') {
    return pathToFileURL(processorFile).href;
  }

  return pathToFileURL(processorFile, { windows: true }).href;
}
