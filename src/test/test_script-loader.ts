import { expect } from 'chai';
import * as path from 'path';
import {
  addScriptPathMapping,
  getPkgJsonDir,
  loadScript,
  resolvePath,
  ScriptInfo,
  ScriptLoaderError,
} from '../commands/scriptLoader';

// eslint-disable-next-line mocha/no-exclusive-tests
describe.only('scriptLoader', () => {
  function getRootPath() {
    return path.resolve(path.join(__dirname, '../../'));
  }

  // reading the end banner tags will give us the correct include order
  function parseIncludedFiles(script: string): string[] {
    const LEFT = '---[END';
    const RIGHT = ']---';
    const lines = script.split('\n');
    const res: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const p = line.indexOf(LEFT);
      if (p >= 0) {
        const q = line.indexOf(RIGHT, p);
        if (q > p) {
          const filename = line.substring(p + LEFT.length, q - 1).trim();
          res.push(filename);
        }
      }
    }

    return res;
  }

  describe('when using path mappings', () => {
    it('correctly determines the path to the project root', () => {
      const expected = getRootPath();
      expect(getPkgJsonDir()).to.be.eql(expected);
    });

    it('considers paths to be relative to the caller', () => {
      const expectedPath = path.join(__dirname, '../actual.lua');
      addScriptPathMapping('test', '../');
      const actual = resolvePath('<test>/actual.lua');
      expect(expectedPath).to.be.eql(actual);
    });

    it('substitutes mapped paths', () => {
      const expectedPath = __dirname + '/fixtures/scripts/actual.lua';
      addScriptPathMapping('test', './fixtures/scripts');
      const actual = resolvePath('<test>/actual.lua');
      expect(expectedPath).to.be.eql(actual);
    });

    it('substitutes ~ with the project root', () => {
      const expectedPath = path.join(getRootPath(), '/scripts/actual.lua');
      const actual = resolvePath('~/scripts/actual.lua');
      expect(expectedPath).to.be.eql(actual);
    });

    it('substitutes "base" with the bullmq base commands folder', () => {
      const expectedPath = path.join(
        getRootPath(),
        '/src/commands/pause-4.lua',
      );
      const actual = resolvePath('<base>/pause-4.lua');
      expect(expectedPath).to.be.eql(actual);
    });

    it('errors on an unrecognized mapping', () => {
      let didThrow = false;
      let error: ScriptLoaderError;
      try {
        resolvePath('<unknown>/pause-4.lua');
      } catch (err) {
        error = <ScriptLoaderError>err;
        didThrow = true;
      }

      expect(didThrow).to.eql(true);
      expect(error.message).to.have.string('No path mapping found');
    });
  });

  describe('when loading files', () => {
    it('handles basic includes', async () => {
      const fixture =
        __dirname + '/fixtures/scripts/fixture_simple_include.lua';
      const script = await loadScript(fixture);
      expect(script).to.not.eql(undefined);
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
        (res, include) => res + (include === 'includes/strings.lua' ? 1 : 0),
        0,
      );
      expect(count).to.eql(1);
    });

    it('inserts scripts in dependency order', async () => {
      const fixture =
        __dirname + '/fixtures/scripts/fixture_recursive_parent.lua';
      const script = await loadScript(fixture);
      const includes = parseIncludedFiles(script);
      const expected = [
        'includes/strings.lua',
        'includes/fixture_recursive_great_grandchild.lua',
        'includes/fixture_recursive_grandchild.lua',
        'includes/fixture_recursive_child.lua',
      ];
      expect(includes).to.eql(expected);
    });

    it('handles glob patterns in @includes statement', async () => {
      const fixture = __dirname + '/fixtures/scripts/fixture_glob_includes.lua';
      const cache = new Map<string, ScriptInfo>();
      const script = await loadScript(fixture, cache);
      const includes = parseIncludedFiles(script);

      const expected = [
        'includes/fixture_glob_include_1.lua',
        'includes/fixture_glob_include_2.lua',
      ];
      expected.forEach(include => {
        expect(includes).to.include(include);
      });
    });

    it('supports path mapping', async () => {
      const includePath = __dirname + '/fixtures/scripts/include';
      addScriptPathMapping('includes', './fixtures/scripts/includes');
      const fixture = __dirname + '/fixtures/scripts/fixture_path_mapped.lua';
      const cache = new Map<string, ScriptInfo>();
      const script = await loadScript(fixture, cache);
      const info = cache.get(path.resolve(fixture));

      expect(script).to.not.eql(undefined);
      expect(info).to.not.eql(undefined);
      expect(info.includes.length).to.eql(1);

      const include = info.includes[0];
      expect(include.name).to.eql('math');
      expect(include.path.startsWith(includePath)).to.be.true;
    });

    it('supports path mapping and globs simultaneously', async () => {
      addScriptPathMapping('map-glob', './fixtures/scripts/mapped');
      const fixture =
        __dirname + '/fixtures/scripts/fixture_path_mapped_glob.lua';
      const cache = new Map<string, ScriptInfo>();
      const script = await loadScript(fixture, cache);
      const info = cache.get(path.resolve(fixture));

      expect(info).to.not.eql(undefined);
      expect(info.includes.length).to.eql(2);
      expect(script).to.not.eql(undefined);

      const includes = info.includes.map(x => x.name);

      const expected = ['fixture_mapped_include_1', 'fixture_mapped_include_2'];

      expect(includes).to.eql(expected);
    });

    it('errors on a missing include', async () => {
      const fixture =
        __dirname + '/fixtures/scripts/fixture_missing_include.lua';

      let didThrow = false;
      let error: ScriptLoaderError;
      try {
        await loadScript(fixture);
      } catch (err) {
        error = <ScriptLoaderError>err;
        didThrow = true;
      }

      expect(didThrow).to.eql(true);
      expect(error.message).to.have.string('include not found');
    });

    it('detects circular dependencies', async () => {
      const fixture =
        __dirname + '/fixtures/scripts/fixture_circular_dependency.lua';
      const child =
        __dirname + '/fixtures/scripts/fixture_circular_dependency_child.lua';

      let didThrow = false;
      let error: ScriptLoaderError;
      try {
        await loadScript(fixture);
      } catch (err) {
        error = <ScriptLoaderError>err;
        didThrow = true;
      }

      expect(didThrow).to.eql(true);
      expect(error.includes).to.include(child);
    });

    it('prevents multiple includes of a file in a single script', async () => {
      const fixture =
        __dirname + '/fixtures/scripts/fixture_duplicate_include.lua';

      let didThrow = false;
      let error: ScriptLoaderError;
      try {
        await loadScript(fixture);
      } catch (err) {
        error = <ScriptLoaderError>err;
        didThrow = true;
      }

      expect(didThrow).to.eql(true);
      expect(error.message).to.have.string('includes/utils');
    });
  });
});
