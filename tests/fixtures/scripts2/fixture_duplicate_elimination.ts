const content = `---
--- Fixture for script deduplication
--- We include multiple scripts which directly or
--- transitively include "strings.lua". It should only be included once
---
--- @include "includes_fixture_recursive_grandchild"
--- @include "includes_utils"
--- @include "includes_strings"
`;

export const fixture_duplicate_elimination = {
  content,
};
