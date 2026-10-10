--[[
  Removes one subscription (endpoint → pattern) and drops the pattern from
  the index when it has no more subscribers. Does not touch the endpoint's
  membership in the node's endpoint set.

  Returns 1 if the subscription existed, 0 otherwise.
]]

--- @include "relayTopics"

local function removeRelaySubscription(baseKey, nodeId, endpointId, pattern)
  local endpointKey = baseKey .. ":ep:" .. nodeId .. ":" .. endpointId
  local removed = rcall("SREM", endpointKey, pattern)
  local patternKey = baseKey .. ":sub:p:" .. pattern
  rcall("SREM", patternKey, nodeId .. "/" .. endpointId)
  if rcall("SCARD", patternKey) == 0 then
    local segments = parseRelayTopic(pattern, true)
    if segments then
      rcall("SREM", baseKey .. ":sub:i:" .. getRelayPatternRoot(segments), pattern)
    end
  end
  return removed
end
