--[[
  Records that a relay namespace is in use until a given time, in the
  registry of namespaces of a prefix (used by dashboards to find them).
  Entries and the registry itself expire on their own.

  The registry is a separate key (not under the namespace's hash tag), so it
  is updated in its own call.

  Input:
    KEYS[1] registry key ({prefix}::relay:namespaces)

    ARGV[1] namespace
    ARGV[2] in use for (ms)
]]
local rcall = redis.call

--- @include "includes/relayTime"

local now = getRelayTime()
rcall("ZADD", KEYS[1], "GT", now + tonumber(ARGV[2]), ARGV[1])
rcall("ZREMRANGEBYSCORE", KEYS[1], "-inf", now)
rcall("PEXPIREAT", KEYS[1], getRelayLastScore(KEYS[1]))
