const content = `--- @include "includes/fixture_recursive_grandchild"
--- file: fixture_recursive_child.lua
`;

export const includes_fixture_recursive_child = {
  path: 'includes/fixture_recursive_child',
  name: 'fixture_recursive_child',
  content,
};
