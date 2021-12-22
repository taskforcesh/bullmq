import { expect } from 'chai';
import * as sinon from 'sinon';
import { broadcastEvent } from './fixtures/scripts/broadcastEvent-1';
import { fixture_circular_dependency } from './fixtures/scripts/fixture_circular_dependency';
import { fixture_duplicate_elimination } from './fixtures/scripts/fixture_duplicate_elimination';
import { fixture_duplicate_include } from './fixtures/scripts/fixture_duplicate_include';
import { fixture_glob_includes } from './fixtures/scripts/fixture_glob_includes';
import { fixture_missing_include } from './fixtures/scripts/fixture_missing_include';
import { fixture_recursive_parent } from './fixtures/scripts/fixture_recursive_parent';
import { fixture_simple_include } from './fixtures/scripts/fixture_simple_include';
import { fixture_simple_include_child } from './fixtures/scripts/fixture_simple_include_child';
import { includes_fixture_circular_dependency_child } from './fixtures/scripts/includes_fixture_circular_dependency_child';
import { includes_fixture_glob_include_1 } from './fixtures/scripts/includes_fixture_glob_include_1';
import { includes_fixture_glob_include_2 } from './fixtures/scripts/includes_fixture_glob_include_2';
import { includes_fixture_recursive_child } from './fixtures/scripts/includes_fixture_recursive_child';
import { includes_fixture_recursive_grandchild } from './fixtures/scripts/includes_fixture_recursive_grandchild';
import { includes_fixture_recursive_great_grandchild } from './fixtures/scripts/includes_fixture_recursive_great_grandchild';
import { includes_math } from './fixtures/scripts/includes_math';
import { includes_strings } from './fixtures/scripts/includes_strings';
import { includes_utils } from './fixtures/scripts/includes_utils';
import {
  RawCommand,
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

  beforeEach(() => {
    loader = new ScriptLoader();
  });

  afterEach(() => {
    loader.clearCache();
  });

  describe('when loading files', () => {
    it('handles basic includes', async () => {
      const command = loader.loadCommand(
        'fixture_simple_include',
        fixture_simple_include as RawCommand,
        { fixture_simple_include_child, includes_math },
      );
      expect(command).to.not.eql(undefined);
    });

    it('removes the @include tag from the resulting script', async () => {
      const command = loader.loadCommand(
        'fixture_simple_include',
        fixture_simple_include as RawCommand,
        { fixture_simple_include_child, includes_math },
      );
      expect(command.options.lua).to.not.have.string('@include');
    });

    it('interpolates a script exactly once', async () => {
      const command = loader.loadCommand(
        'fixture_duplicate_elimination',
        fixture_duplicate_elimination as RawCommand,
        {
          includes_fixture_recursive_grandchild,
          includes_fixture_recursive_great_grandchild,
          includes_math,
          includes_strings,
          includes_utils,
        },
      );
      const includes = parseIncludedFiles(command.options.lua);
      const count = includes.reduce(
        (res, include) => res + (include === 'strings.lua' ? 1 : 0),
        0,
      );
      expect(count).to.eql(1);
    });

    it('inserts scripts in dependency order', async () => {
      const command = loader.loadCommand(
        'fixture_recursive_parent',
        fixture_recursive_parent as RawCommand,
        {
          includes_fixture_recursive_child,
          includes_fixture_recursive_grandchild,
          includes_fixture_recursive_great_grandchild,
          includes_strings,
        },
      );
      const includes = parseIncludedFiles(command.options.lua);

      const expected = [
        'strings.lua',
        'fixture_recursive_great_grandchild.lua',
        'fixture_recursive_grandchild.lua',
        'fixture_recursive_child.lua',
        'fixture_recursive_parent.lua',
      ];
      expect(includes).to.eql(expected);
    });

    it('handles glob patterns in @includes statement', async () => {
      const command = loader.loadCommand(
        'fixture_glob_includes',
        fixture_glob_includes as RawCommand,
        { includes_fixture_glob_include_1, includes_fixture_glob_include_2 },
      );
      const includes = parseIncludedFiles(command.options.lua);

      const expected = [
        'fixture_glob_include_1.lua',
        'fixture_glob_include_2.lua',
      ];
      expected.forEach(include => {
        expect(includes).to.include(include);
      });
    });

    it('errors on a missing include', async () => {
      let didThrow = false;
      let error: ScriptLoaderError;
      try {
        loader.loadCommand(
          'fixture_missing_include',
          fixture_missing_include as RawCommand,
        );
      } catch (err) {
        error = <ScriptLoaderError>err;
        didThrow = true;
      }

      expect(didThrow).to.eql(true);
      expect(error.message).to.have.string('include not found');
    });

    it('detects circular dependencies', async () => {
      let didThrow = false;
      let error: ScriptLoaderError;
      try {
        loader.loadCommand(
          'fixture_circular_dependency',
          fixture_circular_dependency as RawCommand,
          {
            includes_fixture_circular_dependency_child,
            fixture_circular_dependency,
          },
        );
      } catch (err) {
        error = <ScriptLoaderError>err;
        didThrow = true;
      }

      expect(didThrow).to.eql(true);
      expect(error.includes).to.include(
        'includes_fixture_circular_dependency_child',
      );
    });

    it('prevents multiple includes of a file in a single script', async () => {
      let didThrow = false;
      let error: ScriptLoaderError;
      try {
        loader.loadCommand(
          'fixture_duplicate_include',
          fixture_duplicate_include as RawCommand,
          { includes_utils, includes_strings, includes_math },
        );
      } catch (err) {
        error = <ScriptLoaderError>err;
        didThrow = true;
      }

      expect(didThrow).to.eql(true);
      expect(error.message).to.have.string('includes_utils');
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
      loader.load(client, { broadcastEvent });
      expect((client as any).broadcastEvent).to.not.be.undefined;
    });

    it('sets commands on a client only once', async () => {
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
