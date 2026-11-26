// TypeDoc 0.28.x calls `Minimatch#matchOne`, which minimatch 11 made private,
// so `typedoc` crashes with "mini.matchOne is not a function" now that the
// `minimatch` resolution forces v11. Rewrite that single call to use the public
// `match(path, partial)` API (available in minimatch 10 and 11) until TypeDoc
// supports minimatch 11: https://github.com/TypeStrong/typedoc/issues/3150
const fs = require('node:fs');
const path = require('node:path');

const file = path.join(__dirname, '../node_modules/typedoc/dist/node-utils.js');
const patched = 'mini.match(childPath.join("/"), true) !== mini.negate';
const original =
  /mini\.set\.some\(\(row\) => mini\.matchOne\(\s*childPath,\s*row,\s*(?:\/\* partial \*\/\s*)?true\s*\)\)/;

const source = fs.readFileSync(file, 'utf8');

if (source.includes(patched)) {
  console.log('TypeDoc is already patched for minimatch 11');
} else if (original.test(source)) {
  fs.writeFileSync(file, source.replace(original, patched), 'utf8');
  console.log('Patched TypeDoc for minimatch 11');
} else {
  console.error(
    `Could not find the Minimatch#matchOne call in ${file}. TypeDoc may have ` +
      'changed; if it now supports minimatch 11, remove this script and its ' +
      'step in .github/workflows/docs.yml.',
  );
  process.exit(1);
}
