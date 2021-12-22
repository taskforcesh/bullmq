const path = require('path');
const fs = require('fs');
const { promisify } = require('util');
const { argv } = require('process');

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);

const readdir = promisify(fs.readdir);

const loadScripts = async (readDir, writeDir, prefix = '') => {
  const normalizedDir = path.normalize(readDir);

  const files = await readdir(normalizedDir);

  const luaFiles = files.filter(file => path.extname(file) === '.lua');
  const luaDirectories = files.filter(file => path.extname(file) === '');
  const writeFilenamePath = path.normalize(writeDir);

  let indexContent = '';
  if (luaDirectories.length) {
    for (let i = 0; i < luaDirectories.length; i++) {
      await loadScripts(
        path.join(normalizedDir, luaDirectories[i]),
        path.join(writeFilenamePath, luaDirectories[i]),
        `${prefix}-${luaDirectories[i]}`,
      );
      indexContent += `export * from './${luaDirectories[i]}';\n`;
    }
  }

  if (luaFiles.length === 0) {
    /**
     * To prevent unclarified runtime error "updateDelayset is not a function
     * @see https://github.com/OptimalBits/bull/issues/920
     */
    throw new Error('No .lua files found!');
  }

  if (!fs.existsSync(writeFilenamePath)) {
    fs.mkdirSync(writeFilenamePath);
  }

  for (let i = 0; i < luaFiles.length; i++) {
    const completedFilename = path.join(normalizedDir, luaFiles[i]);
    const longName = path.basename(luaFiles[i], '.lua');
    indexContent += `export * from './${longName}';\n`;

    await loadCommand(completedFilename, longName, writeFilenamePath);
  }

  await writeFile(path.join(writeFilenamePath, 'index.ts'), indexContent);
};

const loadCommand = async (filename, longName, writeFilenamePath) => {
  const filenamePath = path.resolve(filename);

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
