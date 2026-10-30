--[[
  Read-only views of a relay namespace, for dashboards. Lists are paginated
  like the queue getters: "start" and "end" are inclusive positions, and an
  "end" of -1 means "to the end".

  Input:
    KEYS[1] nodes key ({base}:nodes)

    ARGV[1] base key
    ARGV[2] view: counts | used | nodes | subscriptions | patterns | retained
    ARGV[3] start
    ARGV[4] end
    ARGV[5] subscriptions filter: "" (all) | node | pattern
    ARGV[6] filter value (node id or pattern)

  Output (one array per item):
    counts         { nodes, subscriptions, patterns, retained }
    used           1 if the namespace has a live node or retained message,
                   else 0 (a single value, not an array)
    nodes          { id, registered at, lease until, info, last heartbeat,
                     backlog, dropped, subscriptions } (ordered by registration;
                     an expired node not swept yet has an empty info)
    subscriptions  { node id, endpoint id, pattern }
    patterns       { pattern, subscriptions }
    retained       { topic, expires at, mid, ts, data } (ordered by expiry)
]]
local rcall = redis.call

--- @include "includes/relayIndex"
--- @include "includes/relayTime"

local baseKey = ARGV[1]
local view = ARGV[2]
local first = tonumber(ARGV[3])
local last = tonumber(ARGV[4])
local subsKey = baseKey .. ":subs"
local retainedKey = baseKey .. ":retained"

-- LIMIT arguments for the inclusive [first, last] window.
local function window()
  if last < 0 then
    return first, -1
  end
  return first, math.max(0, last - first + 1)
end

local function lexPage(prefix)
  local offset, count = window()
  if count == 0 then
    return {}
  end
  local min, max = relayRange(prefix)
  local members = rcall("ZRANGEBYLEX", subsKey, min, max, "LIMIT", offset, count)
  for i = 1, #members do
    members[i] = string.sub(members[i], #prefix + 1)
  end
  return members
end

local function lexCount(prefix)
  local min, max = relayRange(prefix)
  return rcall("ZLEXCOUNT", subsKey, min, max)
end

if view == "counts" then
  return { rcall("ZCARD", KEYS[1]), lexCount("n|"), lexCount("t|"),
    rcall("ZCOUNT", retainedKey, "(" .. getRelayTime(), "+inf") }
end

if view == "used" then
  local now = "(" .. getRelayTime()
  if rcall("ZCOUNT", KEYS[1], now, "+inf") > 0 or
    rcall("ZCOUNT", retainedKey, now, "+inf") > 0 then
    return 1
  end
  return 0
end

local rows = {}

if view == "nodes" then
  local nodes = rcall("ZRANGE", baseKey .. ":started", first, last, "WITHSCORES")
  for i = 1, #nodes, 2 do
    local nodeId = nodes[i]
    local record = rcall("HMGET", baseKey .. ":" .. nodeId .. ":node",
      "info", "hb", "backlog", "dropped")
    rows[#rows + 1] = { nodeId, nodes[i + 1],
      rcall("ZSCORE", KEYS[1], nodeId) or "", record[1] or "", record[2] or "",
      record[3] or "0", record[4] or "0", lexCount("n|" .. nodeId .. "|") }
  end
elseif view == "subscriptions" then
  local filter = ARGV[5]
  local value = ARGV[6]
  if filter == "node" then
    local members = lexPage("n|" .. value .. "|")
    for i = 1, #members do
      local endpointId, pattern = splitRelayEndpointPattern(members[i])
      rows[#rows + 1] = { value, endpointId, pattern }
    end
  elseif filter == "pattern" then
    local members = lexPage("p|" .. value .. "|")
    for i = 1, #members do
      local nodeId, endpointId = splitRelayEndpointPattern(members[i])
      rows[#rows + 1] = { nodeId, endpointId, value }
    end
  else
    local members = lexPage("n|")
    for i = 1, #members do
      local nodeId, rest = splitRelayEndpointPattern(members[i])
      local endpointId, pattern = splitRelayEndpointPattern(rest)
      rows[#rows + 1] = { nodeId, endpointId, pattern }
    end
  end
elseif view == "patterns" then
  local patterns = lexPage("t|")
  for i = 1, #patterns do
    rows[#rows + 1] = { patterns[i], lexCount("p|" .. patterns[i] .. "|") }
  end
elseif view == "retained" then
  local offset, count = window()
  if count ~= 0 then
    local topics = rcall("ZRANGEBYSCORE", retainedKey, "(" .. getRelayTime(),
      "+inf", "WITHSCORES", "LIMIT", offset, count)
    for i = 1, #topics, 2 do
      local value = rcall("HMGET", baseKey .. ":" .. topics[i] .. ":ret", "m", "ts", "d")
      if value[1] then
        rows[#rows + 1] = { topics[i], topics[i + 1], value[1], value[2], value[3] }
      end
    end
  end
end

return rows
