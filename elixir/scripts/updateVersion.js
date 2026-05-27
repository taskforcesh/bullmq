/**
 * Script to update the version in mix.exs
 * Usage: node scripts/updateVersion.js <version>
 */

const fs = require('fs');
const path = require('path');

const version = process.argv[2];

if (!version) {
  console.error('Usage: node scripts/updateVersion.js <version>');
  process.exit(1);
}

const mixExsPath = path.join(__dirname, '..', 'mix.exs');

// Read the current mix.exs
let content = fs.readFileSync(mixExsPath, 'utf8');

// Update the @version module attribute
// Matches: @version "x.y.z" (with any version number)
const versionRegex = /@version\s+"[\d.]+"/;

if (!versionRegex.test(content)) {
  console.error('Could not find @version in mix.exs');
  process.exit(1);
}

content = content.replace(versionRegex, `@version "${version}"`);

// Write the updated content back
fs.writeFileSync(mixExsPath, content, 'utf8');

console.log(`Updated mix.exs version to ${version}`);
