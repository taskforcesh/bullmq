import * as path from 'path';
import * as sinon from 'sinon';
import { describe, beforeEach, afterEach, it, expect } from 'vitest';
import {
  ScriptLoader,
  ScriptLoaderError,
  ScriptMetadata,
} from '../src/commands';
import { RedisConnection } from '../src/classes';
import { RedisClient } from '../src/interfaces';

describe('scriptLoader', () => {
  let loader: ScriptLoader;
  const basePath = __dirname + '/../src/commands';

  function getRootPath() {
    return path.resolve(path.join(__dirname, '../'));
  }

  function parseIncludedFiles(script: string): string[] {
    const left = '--- file:';
    const lines = script.split('\n');
    const res: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const p = line.indexOf(left);
      if (p >= 0) {
        const filename = line.substring(p + left.length).trim();
        res.push(filename);
      }
    }

    return res;
  }

  beforeEach(() => {
    loader = new ScriptLoader({
      base: basePath,
    });
  });

  describe('when using path mappings', () => {
    it('relative paths are relative to the caller of "addScriptPathMapping"', () => {
      const expectedPath = path.join(__dirname, '../actual.lua');
      loader.addPathMapping('test', '../');
      const actual = loader.resolvePath('<test>/actual.lua');
      expect(expectedPath).toEqual(actual);
    });

    // TODO: This test relies on module.paths which is CommonJS-specific and doesn't work under ESM/Vitest
    it.skip('mappings can be absolute based on project root', () => {
      const expectedPath = path.join(
        getRootPath(),
        '/scripts/metrics/actual.lua',
      );
      loader.addPathMapping('test', '~/scripts/metrics');
      const actual = loader.resolvePath('<test>/actual.lua');
      expect(actual).toEqual(expectedPath);
    });

    it('mappings can be based on other mapped paths', () => {
      const basePath = path.join(__dirname, '../');
      const childPath = path.join(basePath, '/child');
      const grandChildPath = path.join(basePath, '/child/grandchild');

      loader.addPathMapping('parent', '../');
      loader.addPathMapping('child', '<parent>/child');
      loader.addPathMapping('grandchild', '<child>/grandchild');

      let p = loader.resolvePath('<grandchild>/actual.lua');
      expect(p.startsWith(grandChildPath)).toBe(true);
      expect(p.startsWith(childPath)).toBe(true);
      expect(p.startsWith(basePath)).toBe(true);

      p = loader.resolvePath('<child>/actual.lua');
      expect(p.startsWith(childPath)).toBe(true);
      expect(p.startsWith(basePath)).toBe(true);
    });

    it('substitutes mapped paths', () => {
      const expectedPath = __dirname + '/fixtures/scripts/actual.lua';
      loader.addPathMapping('test', './fixtures/scripts');
      const actual = loader.resolvePath('<test>/actual.lua');
      expect(expectedPath).toEqual(actual);
    });

    // TODO: This test relies on module.paths which is CommonJS-specific and doesn't work under ESM/Vitest
    it.skip('substitutes ~ with the project root', () => {
      const expectedPath = path.join(getRootPath(), '/scripts/actual.lua');
      const actual = loader.resolvePath('~/scripts/actual.lua');
      expect(actual).toEqual(expectedPath);
    });

    it('substitutes "base" with the bullmq base commands folder', () => {
      const expectedPath = path.join(
        getRootPath(),
        '/src/commands/pause-4.lua',
      );
      const actual = loader.resolvePath('<base>/pause-4.lua');
      expect(expectedPath).toEqual(actual);
    });

    it('errors on an unrecognized mapping', () => {
      let didThrow = false;
      let error: ScriptLoaderError;
      try {
        loader.resolvePath('<unknown>/pause-4.lua');
      } catch (err) {
        error = <ScriptLoaderError>err;
        didThrow = true;
      }

      expect(didThrow).toEqual(true);
      expect(error.message).toContain('No path mapping found');
    });
  });

  describe('when loading files', () => {
    async function loadScript(
      filename: string,
      cache?: Map<string, ScriptMetadata>,
    ): Promise<string> {
      const command = await loader.loadCommand(
        filename,
        __dirname + '/fixtures/scripts/',
        cache,
      );
      return command.options.lua;
    }

    it('handles basic includes', async () => {
      const fixture =
        __dirname + '/fixtures/scripts/fixture_simple_include.lua';
      const command = await loader.loadCommand(
        fixture,
        __dirname + '/fixtures/scripts/',
      );
      expect(command).not.toEqual(undefined);
    });

    it('normalizes path before loading', async () => {
      const path =
        __dirname + '/fixtures/scripts/includes/../fixture_simple_include.lua';
      const command = await loader.loadCommand(
        path,
        __dirname + '/fixtures/scripts/',
      );
      expect(command).not.toEqual(undefined);
    });

    it('removes the @include tag from the resulting script', async () => {
      const fixture =
        __dirname + '/fixtures/scripts/fixture_simple_include.lua';
      const script = await loadScript(fixture);
      expect(script).to.not.have.string('@include');
    });

    it('interpolates a script exactly once', async () => {
      const fixture =
        __dirname + '/fixtures/scripts/fixture_duplicate_elimination.lua';
      const script = await loadScript(fixture);
      const includes = parseIncludedFiles(script);
      const count = includes.reduce(
        (res, include) => res + (include === 'strings.lua' ? 1 : 0),
        0,
      );
      expect(count).toEqual(1);
    });

    it('inserts scripts in dependency order', async () => {
      const fixture =
        __dirname + '/fixtures/scripts/fixture_recursive_parent.lua';
      const script = await loadScript(fixture);
      const includes = parseIncludedFiles(script);

      const expected = [
        'strings.lua',
        'fixture_recursive_great_grandchild.lua',
        'fixture_recursive_grandchild.lua',
        'fixture_recursive_child.lua',
        'fixture_recursive_parent.lua',
      ];
      expect(includes).toEqual(expected);
    });

    it('handles glob patterns in @includes statement', async () => {
      const fixture = __dirname + '/fixtures/scripts/fixture_glob_includes.lua';
      const cache = new Map<string, ScriptMetadata>();
      const script = await loadScript(fixture, cache);
      const includes = parseIncludedFiles(script);

      const expected = [
        'fixture_glob_include_1.lua',
        'fixture_glob_include_2.lua',
      ];
      expected.forEach(include => {
        expect(includes).toContain(include);
      });
    });

    it('supports path mapping', async () => {
      const includePath = __dirname + '/fixtures/scripts/include';
      loader.addPathMapping('includes', './fixtures/scripts/includes');
      const fixture = __dirname + '/fixtures/scripts/fixture_path_mapped.lua';
      const cache = new Map<string, ScriptMetadata>();
      await loader.loadCommand(
        fixture,
        __dirname + '/fixtures/scripts/',
        cache,
      );
      const info = cache.get(path.basename(path.resolve(fixture), '.lua'));

      expect(info).not.toEqual(undefined);
      expect(info?.includes.length).toEqual(1);

      const include = info?.includes[0];
      expect(include?.name).toEqual('math');
      expect(include?.path.startsWith(includePath)).toBe(true);
    });

    it('supports path mapping and globs simultaneously', async () => {
      loader.addPathMapping('map-glob', './fixtures/scripts/mapped');
      const fixture =
        __dirname + '/fixtures/scripts/fixture_path_mapped_glob.lua';
      const cache = new Map<string, ScriptMetadata>();

      await loader.loadCommand(
        fixture,
        __dirname + '/fixtures/scripts/',
        cache,
      );
      const info = cache.get(path.basename(path.resolve(fixture), '.lua'));

      expect(info).not.toEqual(undefined);
      expect(info.includes.length).toEqual(2);

      const includes = info.includes.map(x => x.name);

      const expected = ['fixture_mapped_include_1', 'fixture_mapped_include_2'];

      expect(includes).toEqual(expected);
    });

    it('errors on a missing include', async () => {
      const fixture =
        __dirname + '/fixtures/scripts/fixture_missing_include.lua';

      let didThrow = false;
      let error: ScriptLoaderError;
      try {
        await loader.loadCommand(fixture, __dirname + '/fixtures/scripts/');
      } catch (err) {
        error = <ScriptLoaderError>err;
        didThrow = true;
      }

      expect(didThrow).toEqual(true);
      expect(error.message).toContain('include not found');
    });

    it('detects circular dependencies', async () => {
      const fixture =
        __dirname + '/fixtures/scripts/fixture_circular_dependency.lua';
      const child =
        __dirname + '/fixtures/scripts/fixture_circular_dependency_child.lua';

      let didThrow = false;
      let error: ScriptLoaderError;
      try {
        await loader.loadCommand(fixture, __dirname + '/fixtures/scripts/');
      } catch (err) {
        error = <ScriptLoaderError>err;
        didThrow = true;
      }

      expect(didThrow).toEqual(true);
      expect(error.includes).toContain(child);
    });

    it('prevents multiple includes of a file in a single script', async () => {
      const fixture =
        __dirname + '/fixtures/scripts/fixture_duplicate_include.lua';

      let didThrow = false;
      let error: ScriptLoaderError;
      try {
        await loader.loadCommand(fixture, __dirname + '/fixtures/scripts/');
      } catch (err) {
        error = <ScriptLoaderError>err;
        didThrow = true;
      }

      expect(didThrow).toEqual(true);
      expect(error.message).toContain('includes/utils');
    });

    it('loads all files in a directory', async () => {
      const dirname = __dirname + '/fixtures/scripts/dir-test';
      const commands = await loader.loadScripts(dirname);
      ['one', 'two', 'three'].forEach(name => {
        expect(!!commands.find(x => x.name === name)).toBe(true);
      });
    });

    it('caches loadScripts calls per directory', async () => {
      const loader = new ScriptLoader({
        base: basePath,
      });
      const loadScriptSpy = sinon.spy(loader, 'loadScripts');

      const dirname = __dirname + '/fixtures/scripts/dir-test';
      const dirname1 = __dirname + '/fixtures/scripts/load';

      await loader.loadScripts(dirname);
      await loader.loadScripts(dirname);
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      expect(loader.loadScripts.calledOnce);

      await loader.loadScripts(dirname1);
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      expect(loader.loadScripts.calledTwice);

      await loader.loadScripts(dirname1);
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      expect(loader.loadScripts.calledTwice);
      loadScriptSpy.restore();
    });

    it('throws error if no lua files are found in a directory', async () => {
      const dirname = __dirname + '/fixtures/scripts/dir-test/empty';

      await expect(loader.loadScripts(dirname)).rejects.toThrow(
        'No .lua files found!',
      );
    });

    it('does not load non .lua files', async () => {
      const dirname = __dirname + '/fixtures/scripts/dir-test/non-lua';

      const commands = await loader.loadScripts(dirname);

      expect(commands.length).toEqual(1);
      expect(commands[0].name).toEqual('test');
    });
  });

  describe('when initializing a RedisClient', () => {
    const path = __dirname + '/fixtures/scripts/load';
    let client: RedisClient;
    let connection: RedisConnection;
    //let loader: ScriptLoader;

    beforeEach(async () => {
      connection = new RedisConnection({});
      connection.on('error', () => {});
      client = await connection.client;
      await RedisConnection.waitUntilReady(client);
    });

    afterEach(async () => {
      await connection.disconnect();
    });

    it('properly sets commands on the instance', async () => {
      await loader.load(client, path);
      expect((client as any).broadcastEvent).toBeDefined();
    });

    it('sets commands on a client only once', async () => {
      const loadScriptSpy = sinon.spy(loader, 'loadScripts');
      await loader.load(client, path);
      await loader.load(client, path);
      await loader.load(client, path);
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      expect(loader.loadScripts.calledOnce);
      loadScriptSpy.restore();
    });
  });

  describe('.clearCache', () => {
    it('can clear the command cache', async () => {
      const loader = new ScriptLoader({
        base: basePath,
      });
      const loadScriptSpy = sinon.spy(loader, 'loadScripts');

      const dirname = __dirname + '/fixtures/scripts/dir-test';
      const dirname1 = __dirname + '/fixtures/scripts/load';

      await loader.loadScripts(dirname);
      await loader.loadScripts(dirname1);
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      const origCallCount = loader.loadScripts.callCount;

      loader.clearCache();

      await loader.loadScripts(dirname);
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      expect(loader.loadScripts.callCount - origCallCount).to.eq(1);

      await loader.loadScripts(dirname1);
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      expect(loader.loadScripts.callCount - origCallCount).to.eq(2);
      loadScriptSpy.restore();
    });
  });
});
