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

--- @include "includes/relayTopics"

local baseKey = ARGV[1]
local topic = ARGV[2]
local data = ARGV[3]
local timestamp = ARGV[4]
local retainMs = tonumber(ARGV[5])

local topicSegments = parseRelayTopic(topic, false)
if not topicSegments then
  return -1
end

if #data > tonumber(ARGV[6]) then
  return -4
end

local mid = rcall("INCR", baseKey .. ":mid")

if retainMs > 0 then
  local retainedKey = baseKey .. ":ret:" .. topic
  rcall("HSET", retainedKey, "m", mid, "ts", timestamp, "d", data)
  rcall("PEXPIRE", retainedKey, retainMs)
end

-- node id -> { list of endpoint ids, set of endpoint ids }
local targets = {}
local nodeOrder = {}

local function collect(indexKey)
  local patterns = rcall("SMEMBERS", indexKey)
  for i = 1, #patterns do
    local pattern = patterns[i]
    local patternSegments = parseRelayTopic(pattern, true)
    if patternSegments and matchRelayTopic(patternSegments, topicSegments) then
      local members = rcall("SMEMBERS", baseKey .. ":sub:p:" .. pattern)
      for j = 1, #members do
        local slash = string.find(members[j], "/", 1, true)
        local nodeId = string.sub(members[j], 1, slash - 1)
        local endpointId = string.sub(members[j], slash + 1)
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
  end
end

collect(baseKey .. ":sub:i:" .. topicSegments[1])
collect(baseKey .. ":sub:i:*")

local nodeCount = 0
local endpointCount = 0
local maxLen = tonumber(ARGV[7])

for i = 1, #nodeOrder do
  local nodeId = nodeOrder[i]
  if rcall("EXISTS", baseKey .. ":alive:" .. nodeId) == 1 then
    local endpoints = targets[nodeId].list
    rcall("XADD", baseKey .. ":inbox:" .. nodeId, "MAXLEN", "~", maxLen, "*",
      "k", "msg", "t", topic, "m", mid, "ts", timestamp, "d", data,
      "e", table.concat(endpoints, ","))
    nodeCount = nodeCount + 1
    endpointCount = endpointCount + #endpoints
  end
end

return { mid, nodeCount, endpointCount }
