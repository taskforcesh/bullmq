--[[
  Checks if job is in a given list.

  Input:
    KEYS[1]
    ARGV[1]

  Output:
    1 if element found in the list.
]]

-- Includes
--- @include "includes/checkItemInList"

local items = redis.call("LRANGE", KEYS[1] , 0, -1)
return checkItemInList(items, ARGV[1])
