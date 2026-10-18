--[[
  Returns the relay namespaces of a prefix that may be in use (with live
  nodes or retained messages), sorted by name. Nodes can leave and retained
  messages be deleted before their registry entry expires, so callers check
  each one (relayGet "used" view).

  Input:
    KEYS[1] registry key ({prefix}::relay:namespaces)
]]
local rcall = redis.call

--- @include "includes/relayTime"

local namespaces = rcall("ZRANGEBYSCORE", KEYS[1], "(" .. getRelayTime(), "+inf")
table.sort(namespaces)
return namespaces
