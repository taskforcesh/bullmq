--[[
  Prunes dead nodes with a shared work budget, counting both subscriptions and
  empty endpoints. A node cannot register again until its old indexes are gone.
]]

--- @include "removeRelaySubscription"

local function pruneRelayNode(baseKey, nodeId, budget)
  local endpointsKey = baseKey .. ":eps:" .. nodeId
  while budget > 0 do
    local endpointId = rcall("SRANDMEMBER", endpointsKey)
    if not endpointId then
      rcall("SREM", baseKey .. ":cleanup", nodeId)
      return budget - 1
    end
    local endpointKey = baseKey .. ":ep:" .. nodeId .. ":" .. endpointId
    local patterns = rcall("SPOP", endpointKey, budget)
    for i = 1, #patterns do
      removeRelaySubscription(baseKey, nodeId, endpointId, patterns[i])
    end
    budget = budget - math.max(1, #patterns)
    if rcall("SCARD", endpointKey) == 0 then
      rcall("SREM", endpointsKey, endpointId)
    end
  end
  if rcall("SCARD", endpointsKey) == 0 then
    rcall("SREM", baseKey .. ":cleanup", nodeId)
  end
  return budget
end

local function pruneRelayNodes(baseKey, budget)
  while budget > 0 do
    local nodeId = rcall("SRANDMEMBER", baseKey .. ":cleanup")
    if not nodeId then
      return
    end
    budget = pruneRelayNode(baseKey, nodeId, budget)
  end
end
