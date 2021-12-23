import { expect } from 'chai';
import * as sinon from 'sinon';
import * as commands from './fixtures/scripts';
import * as includes from './fixtures/scripts/includes';
import {
  RawCommand,
  RawInclude,
  ScriptLoader,
  ScriptLoaderError,
} from '../src/classes/script-loader';
import { RedisConnection } from '../src/classes';
import { RedisClient } from '../src/interfaces';

describe('scriptLoader', () => {
  let loader: ScriptLoader;

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

  const setMap = (
    map: Map<string, RawInclude | RawCommand>,
    script: RawInclude | RawCommand,
  ) => {
    map.set(script.path, script);
  };

  beforeEach(() => {
    loader = new ScriptLoader();
  });

  afterEach(() => {
    loader.clearCache();
  });

  describe('when loading files', () => {
    it('handles basic includes', async () => {
      const filteredIncludes = new Map();
      setMap(filteredIncludes, includes.includes_fixture_simple_include_child);
      setMap(filteredIncludes, includes.includes_math);
      const command = loader.loadCommand(
        'fixture_simple_include',
        commands.fixture_simple_include as RawCommand,
        filteredIncludes,
      );
      expect(command).to.not.eql(undefined);
    });

    it('removes the @include tag from the resulting script', async () => {
      const filteredIncludes = new Map();
      setMap(filteredIncludes, includes.includes_fixture_simple_include_child);
      setMap(filteredIncludes, includes.includes_math);
      const command = loader.loadCommand(
        'fixture_simple_include',
        commands.fixture_simple_include as RawCommand,
        filteredIncludes,
      );
      expect(command.options.lua).to.not.have.string('@include');
    });

    it('interpolates a script exactly once', async () => {
      const filteredIncludes = new Map();
      setMap(filteredIncludes, includes.includes_fixture_recursive_grandchild);
      setMap(
        filteredIncludes,
        includes.includes_fixture_recursive_great_grandchild,
      );
      setMap(filteredIncludes, includes.includes_math);
      setMap(filteredIncludes, includes.includes_strings);
      setMap(filteredIncludes, includes.includes_utils);
      const command = loader.loadCommand(
        'fixture_duplicate_elimination',
        commands.fixture_duplicate_elimination as RawCommand,
        filteredIncludes,
      );
      const parsedIncludes = parseIncludedFiles(command.options.lua);
      const count = parsedIncludes.reduce(
        (res, include) => res + (include === 'strings.lua' ? 1 : 0),
        0,
      );
      expect(count).to.eql(1);
    });

    it('inserts scripts in dependency order', async () => {
      const filteredIncludes = new Map();
      setMap(filteredIncludes, includes.includes_fixture_recursive_child);
      setMap(filteredIncludes, includes.includes_fixture_recursive_grandchild);
      setMap(
        filteredIncludes,
        includes.includes_fixture_recursive_great_grandchild,
      );
      setMap(filteredIncludes, includes.includes_strings);

      const command = loader.loadCommand(
        'fixture_recursive_parent',
        commands.fixture_recursive_parent as RawCommand,
        filteredIncludes,
      );
      const parsedIncludes = parseIncludedFiles(command.options.lua);

      const expected = [
        'strings.lua',
        'fixture_recursive_great_grandchild.lua',
        'fixture_recursive_grandchild.lua',
        'fixture_recursive_child.lua',
        'fixture_recursive_parent.lua',
      ];
      expect(parsedIncludes).to.eql(expected);
    });

    it('handles glob patterns in @includes statement', async () => {
      const filteredIncludes = new Map();
      setMap(filteredIncludes, includes.includes_fixture_glob_include_1);
      setMap(filteredIncludes, includes.includes_fixture_glob_include_2);

      const command = loader.loadCommand(
        'fixture_glob_includes',
        commands.fixture_glob_includes as RawCommand,
        filteredIncludes,
      );
      const parsedIncludes = parseIncludedFiles(command.options.lua);

      const expected = [
        'fixture_glob_include_1.lua',
        'fixture_glob_include_2.lua',
      ];
      expected.forEach(include => {
        expect(parsedIncludes).to.include(include);
      });
    });

    it('errors on a missing include', async () => {
      let didThrow = false;
      let error: ScriptLoaderError;
      try {
        loader.loadCommand(
          'fixture_missing_include',
          commands.fixture_missing_include as RawCommand,
        );
      } catch (err) {
        error = <ScriptLoaderError>err;
        didThrow = true;
      }

      expect(didThrow).to.eql(true);
      expect(error.message).to.have.string('include not found');
    });

    it('detects circular dependencies', async () => {
      const filteredIncludes = new Map();
      setMap(
        filteredIncludes,
        includes.includes_fixture_circular_dependency_child,
      );
      setMap(filteredIncludes, commands.fixture_circular_dependency);
      let didThrow = false;
      let error: ScriptLoaderError;
      try {
        loader.loadCommand(
          'fixture_circular_dependency',
          commands.fixture_circular_dependency as RawCommand,
          filteredIncludes,
        );
      } catch (err) {
        error = <ScriptLoaderError>err;
        didThrow = true;
      }

      expect(didThrow).to.eql(true);
      expect(error.includes).to.include(
        'includes/fixture_circular_dependency_child',
      );
    });

    it('prevents multiple includes of a file in a single script', async () => {
      const filteredIncludes = new Map();
      setMap(filteredIncludes, includes.includes_utils);
      setMap(filteredIncludes, includes.includes_strings);
      setMap(filteredIncludes, includes.includes_math);
      let didThrow = false;
      let error: ScriptLoaderError;
      try {
        loader.loadCommand(
          'fixture_duplicate_include',
          commands.fixture_duplicate_include as RawCommand,
          filteredIncludes,
        );
      } catch (err) {
        error = <ScriptLoaderError>err;
        didThrow = true;
      }

      expect(didThrow).to.eql(true);
      expect(error.message).to.have.string('includes/utils');
    });
  });

  describe('when initializing a RedisClient', () => {
    let client: RedisClient;
    let connection: RedisConnection;
    let loader: ScriptLoader;

    beforeEach(async () => {
      connection = new RedisConnection();
      client = await connection.client;
      loader = new ScriptLoader();
    });

    afterEach(async () => {
      connection.disconnect();
    });

    it('properly sets commands on the instance', async () => {
      loader.load(client, { broadcastEvent: commands.broadcastEvent });
      expect((client as any).broadcastEvent).to.not.be.undefined;
    });

    it('sets commands on a client only once', async () => {
      const { broadcastEvent } = commands;
      sinon.spy(loader, 'loadScripts');
      loader.load(client, { broadcastEvent });
      loader.load(client, { broadcastEvent });
      loader.load(client, { broadcastEvent });
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      expect(loader.loadScripts.calledOnce);
    });
  });
});
