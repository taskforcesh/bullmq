--[[
  Broadcast a message.

    Input:
      KEYS[1] channel,
      ARGV[1]  event
      ARGV[2]  payload
]]
local channel = KEYS[1]
local event = ARGV[1]
local payload = ARGV[2]

-- Emit  event
redis.call("XADD", channel, "*", "event", event, "payload", payload);
