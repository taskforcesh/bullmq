--[[
  Deletes the retained message of a topic.

  Input:
    KEYS[1] nodes key ({base}:nodes)

    ARGV[1] base key
    ARGV[2] topic

  Output:
    1 - Deleted.
    0 - The topic had no retained message.
   -1 - Invalid topic.
]]
local rcall = redis.call

--- @include "includes/refreshRelayNamespace"
--- @include "includes/relayTopics"

local baseKey = ARGV[1]
local topic = ARGV[2]

if not parseRelayTopic(topic, false) then
  return -1
end

local now = getRelayTime()
local indexKey = baseKey .. ":retained"
rcall("ZREM", indexKey, topic)
rcall("ZREMRANGEBYSCORE", indexKey, "-inf", now)
-- The deleted topic may have been the longest lived: the index and the
-- namespace now expire with the remaining retained messages.
local indexUntil = getRelayLastScore(indexKey)
if indexUntil > 0 then
  rcall("PEXPIREAT", indexKey, indexUntil)
end
local deleted = rcall("DEL", baseKey .. ":" .. topic .. ":ret")
refreshRelayNamespace(baseKey, KEYS[1], now)
return deleted
