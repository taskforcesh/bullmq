--[[
  Subscribes a relay endpoint to a topic pattern. For an exact topic (no
  wildcards) the retained message, if any, is returned atomically with the
  subscription, so no message can fall between the two.

  Input:
    KEYS[1] nodes key ({base}:nodes)

    ARGV[1] base key
    ARGV[2] node id
    ARGV[3] endpoint id
    ARGV[4] pattern

  Output:
    { added (1|0), retained mid, retained ts, retained data }
      (the retained fields are "" when there is no retained message)
   -2 - Invalid pattern.
   -3 - Node not registered.
   -5 - Invalid id.
]]
local rcall = redis.call

--- @include "includes/relayTopics"

local baseKey = ARGV[1]
local nodeId = ARGV[2]
local endpointId = ARGV[3]
local pattern = ARGV[4]

if not isValidRelayId(nodeId) or not isValidRelayId(endpointId) then
  return -5
end

local segments = parseRelayTopic(pattern, true)
if not segments then
  return -2
end

if not rcall("ZSCORE", KEYS[1], nodeId) or
  rcall("EXISTS", baseKey .. ":" .. nodeId .. ":node") == 0 then
  return -3
end

-- See includes/relayIndex.lua for the views of the subscription index.
local subsKey = baseKey .. ":subs"
local hasWildcards = hasRelayWildcards(segments)
local added = rcall("ZADD", subsKey, 0,
  "n|" .. nodeId .. "|" .. endpointId .. "|" .. pattern)
if added == 1 then
  rcall("ZADD", subsKey, 0, "p|" .. pattern .. "|" .. nodeId .. "|" .. endpointId,
    0, "t|" .. pattern)
  -- Only wildcard patterns are indexed: publishes find exact topics directly.
  if hasWildcards then
    rcall("ZADD", subsKey, 0, "w|" .. getRelayPatternRoot(segments) .. "|" .. pattern)
  end
  -- A new index expires with the namespace's routing keys.
  if rcall("PTTL", subsKey) == -1 then
    rcall("PEXPIRE", subsKey, math.max(1, rcall("PTTL", KEYS[1])))
  end
end

if not hasWildcards then
  local retained = rcall("HMGET", baseKey .. ":" .. pattern .. ":ret", "m", "ts", "d")
  if retained[1] then
    return { added, retained[1], retained[2], retained[3] }
  end
end

return { added, "", "", "" }
