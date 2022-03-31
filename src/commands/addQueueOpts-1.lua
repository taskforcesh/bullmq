--[[
  Adds queue opts into meta key.

    Input:
      KEYS[1] 'meta'

      ARGV[1] maxLenEvents
      ARGV[2] limiter
]]
local rcall = redis.call

local limiter = cjson.encode(cmsgpack.unpack(ARGV[2]))

rcall("HMSET", KEYS[1], "maxLenEvents", ARGV[1], "limiter", limiter)
