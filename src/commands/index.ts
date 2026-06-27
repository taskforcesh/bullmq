import { ScriptLoader } from './script-loader';
export { ScriptMetadata, Command, ScriptLoaderError } from './script-loader';

const scriptLoader = new ScriptLoader({
  base: __dirname,
});

export { ScriptLoader, scriptLoader };
