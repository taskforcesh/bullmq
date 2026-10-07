--[[
  Removes every subscription of one relay endpoint and keeps the pattern
  index consistent.

  Keys (relative to baseKey):
    :ep:{node}:{endpoint}   SET   patterns of the endpoint
    :eps:{node}             SET   endpoints of the node
    :sub:p:{pattern}        SET   "{node}/{endpoint}" members of a pattern
    :sub:i:{root}           SET   patterns indexed by root ("*" = wildcard root)

  Returns the number of removed subscriptions.
]]

--- @include "relayTopics"
--- @include "removeRelaySubscription"

local function removeRelayEndpoint(baseKey, nodeId, endpointId)
  local endpointKey = baseKey .. ":ep:" .. nodeId .. ":" .. endpointId
  local patterns = rcall("SMEMBERS", endpointKey)
  for i = 1, #patterns do
    removeRelaySubscription(baseKey, nodeId, endpointId, patterns[i])
  end
  rcall("DEL", endpointKey)
  rcall("SREM", baseKey .. ":eps:" .. nodeId, endpointId)
  return #patterns
end
