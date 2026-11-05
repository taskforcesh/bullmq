const fs = require('node:fs');
const path = require('node:path');

const newVersion = process.argv[2];
const versionFilePath = path.join(__dirname, '../src/version.ts');

const content = `export const version = '${newVersion}';\n`;

fs.writeFileSync(versionFilePath, content, 'utf8');

console.log(`Updated version file to version ${newVersion}`);
