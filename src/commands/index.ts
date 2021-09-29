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
'use strict';
import { template } from 'lodash';
import { RedisClient } from '../classes';

import * as path from 'path';
import * as fs from 'fs';
import * as util from 'util';

const readdir = util.promisify(fs.readdir);
const readFile = util.promisify(fs.readFile);
const exists = util.promisify(fs.exists);

interface Command {
  name: string;
  options: {
    numberOfKeys: number;
    lua: string;
  };
}

export const load = async function(client: RedisClient, pathname: string) {
  const scripts = await loadScripts(pathname);

  scripts.forEach((command: Command) => {
    // Only define the command if not already defined
    if (!(client as any)[command.name]) {
      client.defineCommand(command.name, command.options);
    }
  });
};

async function loadScripts(dir: string): Promise<Command[]> {
  const files = await readdir(dir);

  const includes: { [index: string]: string } = {};
  const includesDir = path.join(dir, 'includes');

  if (await exists(includesDir)) {
    const includesFiles = await readdir(includesDir);

    for (let i = 0; i < includesFiles.length; i++) {
      const file = includesFiles[i];
      const lua = await readFile(path.join(includesDir, file));
      const name = path.basename(file, '.lua');
      includes[name] = lua.toString();
    }
  }

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

  const commands = [];

  for (let i = 0; i < luaFiles.length; i++) {
    const file = luaFiles[i];
    if (path.extname(file) === '.lua') {
      const longName = path.basename(file, '.lua');
      const name = longName.split('-')[0];
      const numberOfKeys = parseInt(longName.split('-')[1]);

      const lua = (await readFile(path.join(dir, file))).toString();
      const compiled = template(lua);

      commands.push({
        name,
        options: { numberOfKeys, lua: compiled(includes) },
      });
    }
  }

  return commands;
}
