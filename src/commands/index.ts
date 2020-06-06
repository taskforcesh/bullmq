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

import { Redis } from 'ioredis';

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

export const load = async function(client: Redis) {
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

  const commands = await Promise.all<Command>(
    files
      .filter((file: string) => path.extname(file) === '.lua')
      .map(async (file: string) => {
        const longName = path.basename(file, '.lua');
        const name = longName.split('-')[0];
        const numberOfKeys = parseInt(longName.split('-')[1]);

        const lua = await readFile(path.join(dir, file));

        return {
          name,
          options: { numberOfKeys, lua: lua.toString() },
        };
      }),
  );

  return commands;
}
