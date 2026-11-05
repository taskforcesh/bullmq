--[[
  Publishes a message on a topic.

  Finds every subscription whose pattern matches the topic and appends one
  entry to the inbox of each live node involved, listing that node's matching
  endpoints. Each endpoint gets the message once, even if several of its
  patterns match.

  Input:
    KEYS[1] nodes key ({base}:nodes)

    ARGV[1] base key
    ARGV[2] topic
    ARGV[3] data (serialized by the caller)
    ARGV[4] timestamp (ms)
    ARGV[5] retain (ms, 0 = do not retain)
    ARGV[6] max data size (bytes)
    ARGV[7] max inbox length (approximate)

  Output:
    { mid, nodes, endpoints }
   -1 - Invalid topic.
   -4 - Data too large.
]]
local rcall = redis.call

--- @include "includes/relayIndex"
--- @include "includes/refreshRelayNamespace"

local baseKey = ARGV[1]
local topic = ARGV[2]
local data = ARGV[3]
local timestamp = ARGV[4]
local retainMs = tonumber(ARGV[5])
local subsKey = baseKey .. ":subs"

local topicSegments = parseRelayTopic(topic, false)
if not topicSegments then
  return -1
end

if #data > tonumber(ARGV[6]) then
  return -4
end

local midKey = baseKey .. ":mid"
local mid
if rcall("EXISTS", midKey) == 1 then
  mid = rcall("INCR", midKey)
else
  -- A new counter starts at the server time in microseconds, so ids stay
  -- unique and increasing after an earlier counter expired, and expires with
  -- the namespace (see refreshRelayNamespace).
  local time = rcall("TIME")
  mid = rcall("INCRBY", midKey, time[1] .. string.format("%06d", time[2]))
  rcall("PEXPIRE", midKey, math.max(1, rcall("PTTL", KEYS[1])))
end

if retainMs > 0 then
  local now = getRelayTime()
  local retainedKey = baseKey .. ":" .. topic .. ":ret"
  rcall("HSET", retainedKey, "m", mid, "ts", timestamp, "d", data)
  rcall("PEXPIRE", retainedKey, retainMs)
  local indexKey = baseKey .. ":retained"
  rcall("ZADD", indexKey, now + retainMs, topic)
  rcall("ZREMRANGEBYSCORE", indexKey, "-inf", now)
  rcall("PEXPIREAT", indexKey, getRelayLastScore(indexKey))
  refreshRelayNamespace(baseKey, KEYS[1], now)
end

-- node id -> { list of endpoint ids, set of endpoint ids }
local targets = {}
local nodeOrder = {}

local function addSubscribers(pattern)
  local prefix = "p|" .. pattern .. "|"
  local min, max = relayRange(prefix)
  local members = rcall("ZRANGEBYLEX", subsKey, min, max)
  for j = 1, #members do
    local nodeId, endpointId =
      splitRelayEndpointPattern(string.sub(members[j], #prefix + 1))
    local target = targets[nodeId]
    if not target then
      target = { list = {}, seen = {} }
      targets[nodeId] = target
      nodeOrder[#nodeOrder + 1] = nodeId
    end
    if not target.seen[endpointId] then
      target.seen[endpointId] = true
      target.list[#target.list + 1] = endpointId
    end
  end
end

-- Wildcard patterns indexed under a root are matched one by one.
local function addMatchingWildcards(root)
  local prefix = "w|" .. root .. "|"
  local min, max = relayRange(prefix)
  local patterns = rcall("ZRANGEBYLEX", subsKey, min, max)
  for i = 1, #patterns do
    local pattern = string.sub(patterns[i], #prefix + 1)
    local patternSegments = parseRelayTopic(pattern, true)
    if patternSegments and matchRelayTopic(patternSegments, topicSegments) then
      addSubscribers(pattern)
    end
  end
end

-- Exact subscriptions: a direct lookup, whatever their number.
addSubscribers(topic)
addMatchingWildcards(topicSegments[1])
addMatchingWildcards("*")

local nodeCount = 0
local endpointCount = 0
local maxLen = tonumber(ARGV[7])

for i = 1, #nodeOrder do
  local nodeId = nodeOrder[i]
  -- The inbox lives exactly as long as its node's record.
  local ttl = rcall("PTTL", baseKey .. ":" .. nodeId .. ":node")
  if ttl > 0 then
    local inboxKey = baseKey .. ":" .. nodeId .. ":inbox"
    local nodeKey = baseKey .. ":" .. nodeId .. ":node"
    local endpoints = targets[nodeId].list
    local nodeMaxLen = tonumber(rcall("HGET", nodeKey, "maxLen")) or maxLen
    local overflow = rcall("XLEN", inboxKey) + 1 - nodeMaxLen
    if overflow > 0 then
      local cursor = rcall("HGET", nodeKey, "inFlight") or
        rcall("HGET", nodeKey, "cursor") or "0-0"
      local consumed = 0
      if cursor ~= "0-0" and cursor ~= "0" then
        consumed = #rcall("XRANGE", inboxKey, "-", cursor, "COUNT", overflow)
      end
      local dropped = rcall("XTRIM", inboxKey, "MAXLEN", nodeMaxLen - 1)
      local unreadDropped = dropped - consumed
      if unreadDropped > 0 then
        rcall("HINCRBY", nodeKey, "dropped", unreadDropped)
      end
    end
    rcall("XADD", inboxKey, "*",
      "k", "msg", "t", topic, "m", mid, "ts", timestamp, "d", data,
      "e", table.concat(endpoints, ","))
    rcall("PEXPIRE", inboxKey, ttl)
    nodeCount = nodeCount + 1
    endpointCount = endpointCount + #endpoints
  end
end

return { mid, nodeCount, endpointCount }
