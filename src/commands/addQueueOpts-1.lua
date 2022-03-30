--[[
  Adds queue opts into meta key.

    Input:
      KEYS[1] 'meta'

      ARGV[1] msgpacked arguments array
            [1]  maxLenEvents
]]
local rcall = redis.call

local opts = cmsgpack.unpack(ARGV[1])

local queueOpts = cjson.encode(opts)

rcall("HSET", KEYS[1], "opts", queueOpts)
