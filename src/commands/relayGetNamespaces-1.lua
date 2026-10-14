--[[
  Returns the relay namespaces of a prefix that are in use (with live nodes
  or retained messages), sorted by name.

  Input:
    KEYS[1] registry key ({prefix}:relay:namespaces)
]]
local rcall = redis.call

--- @include "includes/relayTime"

local namespaces = rcall("ZRANGEBYSCORE", KEYS[1], "(" .. getRelayTime(), "+inf")
table.sort(namespaces)
return namespaces
