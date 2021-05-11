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

import { RedisClient } from '../classes';

const path = require('path');
const util = require('util');

const fs = require('fs');

const readdir = util.promisify(fs.readdir);
const readFile = util.promisify(fs.readFile);

interface Command {
  name: string;
  options: {
    numberOfKeys: number;
    lua: string;
  };
}

export const load = async function(client: RedisClient) {
  const scripts = await loadScripts(__dirname);

  scripts.forEach((command: Command) => {
    // Only define the command if not already defined
    if (!(client as any)[command.name]) {
      client.defineCommand(command.name, command.options);
    }
  });
};

async function loadScripts(dir: string): Promise<Command[]> {
  const files = await readdir(dir);
  const commands = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (path.extname(file) === '.lua') {
      const longName = path.basename(file, '.lua');
      const name = longName.split('-')[0];
      const numberOfKeys = parseInt(longName.split('-')[1]);

      const lua = await readFile(path.join(dir, file));

      commands.push({
        name,
        options: { numberOfKeys, lua: lua.toString() },
      });
    }
  }

  return commands;
}
