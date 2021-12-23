const content = `--- file: fixture_circular_dependency.lua
--- @include "includes/fixture_circular_dependency_child"
`;

export const fixture_circular_dependency = {
  path: 'fixture_circular_dependency',
  name: 'fixture_circular_dependency',
  content,
};
