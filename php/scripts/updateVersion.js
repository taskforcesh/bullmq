/**
 * Script to update the version in composer.json
 * Usage: node scripts/updateVersion.js <version>
 *
 * Note: This only updates php/composer.json for local reference.
 * The root composer.json does not specify a version - Packagist
 * derives versions from git tags.
 */

const fs = require('fs');
const path = require('path');

const version = process.argv[2];

if (!version) {
  console.error('Usage: node scripts/updateVersion.js <version>');
  process.exit(1);
}

// Update php/composer.json (for local development reference)
const phpComposerPath = path.join(__dirname, '..', 'composer.json');
const content = fs.readFileSync(phpComposerPath, 'utf8');
const composer = JSON.parse(content);
composer.version = version;
fs.writeFileSync(
  phpComposerPath,
  JSON.stringify(composer, null, 4) + '\n',
  'utf8',
);
console.log(`Updated php/composer.json version to ${version}`);
