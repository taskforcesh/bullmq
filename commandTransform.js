const path = require('path');
const fs = require('fs');
const { promisify } = require('util');
const { argv } = require('process');

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const readdir = promisify(fs.readdir);

const applyCharacter = (prefix, directory, character) => {
  return prefix ? `${prefix}${character}${directory}` : directory;
};

const loadScripts = async (
  readDir,
  writeDir,
  deep = 0,
  prefix = '',
  pathPrefix = '',
) => {
  const normalizedDir = path.normalize(readDir);

  const files = await readdir(normalizedDir);

  const luaFiles = files.filter(file => path.extname(file) === '.lua');
  const writeFilenamePath = path.normalize(writeDir);

  if (!fs.existsSync(writeFilenamePath)) {
    fs.mkdirSync(writeFilenamePath);
  }

  let indexContent = '';
  if (deep) {
    const luaDirectories = files.filter(file => path.extname(file) === '');
    if (luaDirectories.length) {
      for (let i = 0; i < luaDirectories.length; i++) {
        await loadScripts(
          path.join(normalizedDir, luaDirectories[i]),
          path.join(writeFilenamePath, luaDirectories[i]),
          deep,
          applyCharacter(prefix, luaDirectories[i], '_'),
          applyCharacter(prefix, luaDirectories[i], '/'),
        );
        indexContent += `export * from './${luaDirectories[i]}';\n`;
      }
    }
  }

  if (luaFiles.length === 0) {
    /**
     * To prevent unclarified runtime error "updateDelayset is not a function
     * @see https://github.com/OptimalBits/bull/issues/920
     */
    throw new Error('No .lua files found!');
  }

  for (let i = 0; i < luaFiles.length; i++) {
    const completedFilename = path.join(normalizedDir, luaFiles[i]);
    const longName = path.basename(luaFiles[i], '.lua');
    indexContent += `export * from './${longName}';\n`;

    await loadCommand(
      completedFilename,
      longName,
      writeFilenamePath,
      prefix,
      pathPrefix,
    );
  }

  await writeFile(path.join(writeFilenamePath, 'index.ts'), indexContent);
};

const loadCommand = async (
  filename,
  longName,
  writeFilenamePath,
  prefix,
  pathPrefix,
) => {
  const filenamePath = path.resolve(filename);

  const content = (await readFile(filenamePath)).toString();

  const [name, num] = longName.split('-');
  const numberOfKeys = num && parseInt(num, 10);

  const newContent = `const content = \`${content}\`;

export const ${prefix ? `${prefix}_${name}` : name} = {
  path: '${pathPrefix ? `${pathPrefix}/${name}` : name}',
  name: '${name}',
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

loadScripts(argv[2], argv[3], argv[4], argv[5], argv[6]);
