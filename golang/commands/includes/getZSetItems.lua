--[[
  Function to get ZSet items.
]]

local function getZSetItems(keyName, max)
  return rcall('ZRANGE', keyName, 0, max - 1)
end
