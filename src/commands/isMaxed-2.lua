--[[
  Checks if queue is maxed.

  Input:
    KEYS[1] meta key
    KEYS[2] active key

  Output:
    1 if element found in the list.
]]

local rcall = redis.call

-- Includes
--- @include "includes/isQueueMaxed"

return isQueueMaxed(KEYS[1], KEYS[2])
