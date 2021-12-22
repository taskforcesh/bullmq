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

  let indexContent = '';

  for (let i = 0; i < luaFiles.length; i++) {
    const completedFilename = path.join(normalizedDir, luaFiles[i]);
    const longName = path.basename(luaFiles[i], '.lua');
    indexContent += `export * from './${longName}';\n`;

    await loadCommand(completedFilename, longName, writeDir);
  }

  const writeFilenamePath = path.normalize(writeDir);

  await writeFile(path.join(writeFilenamePath, 'index.ts'), indexContent);
};

const loadCommand = async (filename, longName, writeDir) => {
  const filenamePath = path.resolve(filename);
  const writeFilenamePath = path.normalize(writeDir);

  const content = (await readFile(filenamePath)).toString();

  const [name, num] = longName.split('-');
  const numberOfKeys = num && parseInt(num, 10);

  const newContent = `const content = \`${content}\`;

export const ${name} = {
  content,${
    numberOfKeys
      ? `
  keys: ${numberOfKeys},`
      : ''
  }
};
`;
  await writeFile(path.join(writeFilenamePath, longName + '.ts'), newContent);
};

loadScripts(argv[2], argv[3]);
