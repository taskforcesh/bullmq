import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { toSandboxImportSpecifier } from '../src/classes/sandbox-specifier';

const onWindows = process.platform === 'win32';

describe('toSandboxImportSpecifier', () => {
  describe('absolute filesystem paths', () => {
    it.runIf(onWindows)('converts a Windows drive path to a file URL', () => {
      expect(toSandboxImportSpecifier('D:\\proj\\worker.js')).toBe(
        'file:///D:/proj/worker.js',
      );
      expect(toSandboxImportSpecifier('D:/proj/worker.js')).toBe(
        'file:///D:/proj/worker.js',
      );
      expect(toSandboxImportSpecifier('d:\\proj\\worker.js')).toBe(
        'file:///d:/proj/worker.js',
      );
    });

    it.runIf(onWindows)(
      'encodes characters the way pathToFileURL does on Windows',
      () => {
        expect(toSandboxImportSpecifier('C:\\foo bar\\baz.js')).toBe(
          'file:///C:/foo%20bar/baz.js',
        );
        expect(toSandboxImportSpecifier('C:\\foo#bar\\baz.js')).toBe(
          'file:///C:/foo%23bar/baz.js',
        );
        expect(toSandboxImportSpecifier('C:\\foo%20bar\\baz.js')).toBe(
          'file:///C:/foo%2520bar/baz.js',
        );
      },
    );

    it.runIf(onWindows)('converts a UNC path to a file URL', () => {
      expect(toSandboxImportSpecifier('\\\\server\\share\\worker.js')).toBe(
        'file://server/share/worker.js',
      );
    });

    it.skipIf(onWindows)(
      'leaves Windows drive and UNC paths unchanged off Windows',
      () => {
        expect(toSandboxImportSpecifier('D:\\proj\\worker.js')).toBe(
          'D:\\proj\\worker.js',
        );
        expect(toSandboxImportSpecifier('D:/proj/worker.js')).toBe(
          'D:/proj/worker.js',
        );
        expect(toSandboxImportSpecifier('d:\\proj\\worker.js')).toBe(
          'd:\\proj\\worker.js',
        );
        expect(toSandboxImportSpecifier('\\\\server\\share\\worker.js')).toBe(
          '\\\\server\\share\\worker.js',
        );
      },
    );

    it('converts an absolute path with pathToFileURL', () => {
      const processorFile = path.resolve(
        __dirname,
        'fixtures/fixture_processor_simple.js',
      );

      expect(path.isAbsolute(processorFile)).toBe(true);
      expect(toSandboxImportSpecifier(processorFile)).toBe(
        pathToFileURL(processorFile).href,
      );
    });
  });

  describe('specifiers that must be left unchanged', () => {
    it('leaves file URLs alone, including Windows file URLs', () => {
      const windowsFileUrl = 'file:///D:/proj/worker.js';
      const posixFileUrl = pathToFileURL(
        path.resolve(__dirname, 'fixtures/fixture_processor_simple.js'),
      ).href;

      expect(toSandboxImportSpecifier(windowsFileUrl)).toBe(windowsFileUrl);
      expect(toSandboxImportSpecifier(posixFileUrl)).toBe(posixFileUrl);
      expect(toSandboxImportSpecifier('file://server/share/worker.js')).toBe(
        'file://server/share/worker.js',
      );
    });

    it('leaves other URL schemes alone', () => {
      const dataUrl = 'data:text/javascript,export%20default%20function(){}';
      expect(toSandboxImportSpecifier(dataUrl)).toBe(dataUrl);
      expect(toSandboxImportSpecifier('node:fs')).toBe('node:fs');
    });

    it('leaves relative CommonJS paths alone', () => {
      expect(toSandboxImportSpecifier('./worker.js')).toBe('./worker.js');
      expect(toSandboxImportSpecifier('../worker.cjs')).toBe('../worker.cjs');
      expect(toSandboxImportSpecifier('worker.js')).toBe('worker.js');
      expect(toSandboxImportSpecifier('fixtures/processor.cjs')).toBe(
        'fixtures/processor.cjs',
      );
      // Drive-relative, not absolute. import() still rejects these on
      // Windows; only absolute paths are rewritten.
      expect(toSandboxImportSpecifier('D:worker.js')).toBe('D:worker.js');
    });
  });

  describe('loading an existing processor', () => {
    it('imports a CommonJS processor from its absolute path', async () => {
      const processorFile = path.resolve(
        __dirname,
        'fixtures/fixture_processor_simple.js',
      );
      const specifier = toSandboxImportSpecifier(processorFile);

      expect(specifier.startsWith('file:')).toBe(true);

      const { default: processor } = await import(specifier);
      expect(typeof processor).toBe('function');
      await expect(processor({ data: { n: 1 } })).resolves.toEqual({
        processed: true,
        data: { n: 1 },
      });
    });

    it('imports a .cjs processor from its absolute path', async () => {
      const processorFile = path.resolve(
        __dirname,
        'fixtures/fixture_processor.cjs',
      );
      const { default: processor } = await import(
        toSandboxImportSpecifier(processorFile)
      );

      expect(typeof processor).toBe('function');
    });
  });
});
