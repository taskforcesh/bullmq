const content = `--[[
  Functions to check if a item belongs to a list.
]]

local function checkItemInList(list, item)
  for _, v in pairs(list) do
    if v == item then
      return 1
    end
  end
  return nil
end
`;

export const includes_checkItemInList = {
  path: 'includes/checkItemInList',
  name: 'checkItemInList',
  content,
};
