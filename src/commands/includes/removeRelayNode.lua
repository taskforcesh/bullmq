--[[
  Removes a relay node completely: its subscriptions, endpoints, inbox and
  liveness key.
]]

--- @include "removeRelayEndpoint"

local function removeRelayNode(baseKey, nodesKey, nodeId)
  local endpointsKey = baseKey .. ":eps:" .. nodeId
  local endpoints = rcall("SMEMBERS", endpointsKey)
  for i = 1, #endpoints do
    removeRelayEndpoint(baseKey, nodeId, endpoints[i])
  end
  rcall("DEL", endpointsKey, baseKey .. ":inbox:" .. nodeId,
    baseKey .. ":alive:" .. nodeId)
  return rcall("ZREM", nodesKey, nodeId)
end
