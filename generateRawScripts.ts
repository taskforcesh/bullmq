import { scriptLoader } from './src/commands/index';
import * as path from 'path';

scriptLoader.transpileScripts(
  path.join(__dirname, './src/commands'),
  path.join(__dirname, './rawScripts'),
);
