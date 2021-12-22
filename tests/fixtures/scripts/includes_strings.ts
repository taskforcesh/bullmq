const content = `--- file: strings.lua
local function isString(x)
  return type(x) == 'string'
end
`;

export const includes_strings = {
  content,
};
