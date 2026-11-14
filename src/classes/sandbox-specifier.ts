import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Converts a sandboxed processor path into a specifier `import()` accepts.
 *
 * Absolute filesystem paths become file URLs. On Windows,
 * `import("D:\\proj\\worker.js")` throws `ERR_UNSUPPORTED_ESM_URL_SCHEME`
 * because the drive letter is parsed as a URL protocol. Paths that are
 * not absolute on the host platform are returned unchanged, including
 * relative CommonJS paths and specifiers such as `file:`, `data:`, and
 * `node:` URLs.
 *
 * `pathToFileURL` is called without options so the conversion works on
 * the minimum supported Node version. Windows drive and UNC paths are
 * absolute only on win32, and are converted only there.
 *
 * @param processorFile - Processor filesystem path or URL string.
 * @returns A module specifier safe to pass to dynamic `import()`.
 */
export function toSandboxImportSpecifier(processorFile: string): string {
  return isAbsolute(processorFile)
    ? pathToFileURL(processorFile).href
    : processorFile;
}
