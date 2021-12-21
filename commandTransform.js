const path = require('path');
const fs = require('fs');
const { promisify } = require('util');
const { argv } = require('process');

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);

const readdir = promisify(fs.readdir);

const loadScripts = async (readDir, writeDir) => {
  const normalizedDir = path.normalize(readDir);

  const files = await readdir(normalizedDir);

  const luaFiles = files.filter(file => path.extname(file) === '.lua');

  if (luaFiles.length === 0) {
    /**
     * To prevent unclarified runtime error "updateDelayset is not a function
     * @see https://github.com/OptimalBits/bull/issues/920
     */
    throw new Error('No .lua files found!');
  }

  for (let i = 0; i < luaFiles.length; i++) {
    const completedFilename = path.join(normalizedDir, luaFiles[i]);

    await loadCommand(completedFilename, luaFiles[i], writeDir);
  }
};

const loadCommand = async (filename, file, writeDir) => {
  const filenamePath = path.resolve(filename);
  const writeFilenamePath = path.normalize(writeDir);

  const content = (await readFile(filenamePath)).toString();
  const newContent = `const script = \`${content}\`;

export default script;
`;
  await writeFile(
    path.join(writeFilenamePath, path.basename(file) + '.ts'),
    newContent,
  );
};

loadScripts(argv[2], argv[3]);
