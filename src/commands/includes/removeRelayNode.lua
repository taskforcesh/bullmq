--[[
  Makes a relay node unroutable immediately and queues its subscriptions for
  bounded cleanup. The inbox is freed asynchronously.
]]

local function removeRelayNode(baseKey, nodesKey, nodeId)
  local removed = rcall("ZREM", nodesKey, nodeId)
  rcall("UNLINK", baseKey .. ":inbox:" .. nodeId, baseKey .. ":alive:" .. nodeId)
  if rcall("EXISTS", baseKey .. ":eps:" .. nodeId) == 1 then
    rcall("SADD", baseKey .. ":cleanup", nodeId)
  end
  return removed
end
