--[[
  Function to check for the meta.maxed key to decide if we are maxed or not.
]]
local function isQueueMaxed(queueMetaKey)
  return rcall("HEXISTS", queueMetaKey, "maxed") == 1
end
