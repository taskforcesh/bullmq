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

--- @include "includes/relayTopics"

local baseKey = ARGV[1]
local topic = ARGV[2]

if not parseRelayTopic(topic, false) then
  return -1
end

rcall("ZREM", baseKey .. ":retained", topic)
return rcall("DEL", baseKey .. ":" .. topic .. ":ret")
