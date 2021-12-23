const content = `--- file: fixture_circular_dependency_child.lua
--- @include "fixture_circular_dependency"
`;

export const includes_fixture_circular_dependency_child = {
  path: 'includes/fixture_circular_dependency_child',
  name: 'fixture_circular_dependency_child',
  content,
};
