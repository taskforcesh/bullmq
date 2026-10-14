--[[
  Relay subscription index and node cleanup.

  All subscriptions of a namespace live in one sorted set, {base}:subs, with
  every member at score 0 so members are ordered (and paginated) by value.
  Each subscription is stored under two views, and each subscribed pattern
  under two more:
    n|{node}|{endpoint}|{pattern}   subscriptions of a node or endpoint
    p|{pattern}|{node}|{endpoint}   subscribers of a pattern
    t|{pattern}                     patterns with at least one subscriber
    w|{root}|{pattern}              wildcard patterns by literal root ("*"
                                    for patterns starting with a wildcard)
  "|" can't appear in ids or patterns, so a prefix range selects one view.
]]

--- @include "relayTopics"

-- Lexicographic range (for ZRANGEBYLEX/ZLEXCOUNT) of the members starting
-- with "prefix".
local relayRangeEnd = string.char(255)

local function relayRange(prefix)
  return "[" .. prefix, "[" .. prefix .. relayRangeEnd
end

local function relayHasMember(key, prefix)
  local min, max = relayRange(prefix)
  return #rcall("ZRANGEBYLEX", key, min, max, "LIMIT", 0, 1) > 0
end

--[[
  Removes one subscription, and the pattern's views once it has no
  subscribers left.

  Returns 1 if the subscription existed, 0 otherwise.
]]
local function removeRelaySubscription(baseKey, nodeId, endpointId, pattern)
  local subsKey = baseKey .. ":subs"
  local removed = rcall("ZREM", subsKey,
    "n|" .. nodeId .. "|" .. endpointId .. "|" .. pattern,
    "p|" .. pattern .. "|" .. nodeId .. "|" .. endpointId)
  if not relayHasMember(subsKey, "p|" .. pattern .. "|") then
    rcall("ZREM", subsKey, "t|" .. pattern)
    local segments = parseRelayTopic(pattern, true)
    if segments and hasRelayWildcards(segments) then
      rcall("ZREM", subsKey,
        "w|" .. getRelayPatternRoot(segments) .. "|" .. pattern)
    end
  end
  return removed > 0 and 1 or 0
end

-- Splits a "{endpoint}|{pattern}" suffix of an n| member.
local function splitRelayEndpointPattern(value)
  local bar = string.find(value, "|", 1, true)
  return string.sub(value, 1, bar - 1), string.sub(value, bar + 1)
end

-- Returns the number of removed subscriptions.
local function removeRelayEndpoint(baseKey, nodeId, endpointId)
  local prefix = "n|" .. nodeId .. "|" .. endpointId .. "|"
  local min, max = relayRange(prefix)
  local members = rcall("ZRANGEBYLEX", baseKey .. ":subs", min, max)
  for i = 1, #members do
    removeRelaySubscription(baseKey, nodeId, endpointId,
      string.sub(members[i], #prefix + 1))
  end
  return #members
end

--[[
  Makes a node unroutable immediately: its inbox and record are freed, and
  its subscriptions are queued in {base}:cleanup for bounded pruning.
]]
local function removeRelayNode(baseKey, nodesKey, nodeId, now)
  local removed = rcall("ZREM", nodesKey, nodeId)
  rcall("ZREM", baseKey .. ":started", nodeId)
  rcall("UNLINK", baseKey .. ":" .. nodeId .. ":inbox", baseKey .. ":" .. nodeId .. ":node")
  if relayHasMember(baseKey .. ":subs", "n|" .. nodeId .. "|") then
    rcall("ZADD", baseKey .. ":cleanup", now, nodeId)
  end
  return removed
end

-- Prunes up to "budget" subscriptions of a removed node; returns the budget
-- left (always consuming at least 1, so callers make progress).
local function pruneRelayNode(baseKey, nodeId, budget)
  local prefix = "n|" .. nodeId .. "|"
  local min, max = relayRange(prefix)
  local members = rcall("ZRANGEBYLEX", baseKey .. ":subs", min, max,
    "LIMIT", 0, budget)
  for i = 1, #members do
    local endpointId, pattern =
      splitRelayEndpointPattern(string.sub(members[i], #prefix + 1))
    removeRelaySubscription(baseKey, nodeId, endpointId, pattern)
  end
  if #members < budget then
    rcall("ZREM", baseKey .. ":cleanup", nodeId)
  end
  return budget - math.max(1, #members)
end

-- Prunes removed nodes, oldest first, sharing one work budget.
local function pruneRelayNodes(baseKey, budget)
  while budget > 0 do
    local next = rcall("ZRANGE", baseKey .. ":cleanup", 0, 0)
    if #next == 0 then
      return
    end
    budget = pruneRelayNode(baseKey, next[1], budget)
  end
end
