const fs = require('fs');
const path = require('path');

const newVersion = process.argv[2];
const versionFilePath = path.join(__dirname, '../src/version.ts');

const content = `export const version = '${newVersion}';\n`;

fs.writeFileSync(versionFilePath, content, 'utf8');

console.log(`Updated version file to version ${newVersion}`);
