--[[
  Remove jobs from the specific set.

  Input:
    KEYS[1]  set key,
    KEYS[2]  events stream key

    ARGV[1]  jobKey prefix
    ARGV[2]  timestamp
    ARGV[3]  limit the number of jobs to be removed. 0 is unlimited
    ARGV[4]  set name, can be any of 'wait', 'active', 'paused', 'delayed', 'completed', or 'failed'
]]
local rcall = redis.call
local rangeStart = 0
local rangeEnd = -1

local limit = tonumber(ARGV[3])

-- If we're only deleting _n_ items, avoid retrieving all items
-- for faster performance
--
-- Start from the tail of the list, since that's where oldest elements
-- are generally added for FIFO lists
if limit > 0 then
  rangeStart = -1 - limit + 1
  rangeEnd = -1
end

-- Includes
--- @include "includes/cleanList"
--- @include "includes/cleanSet"

local result
if ARGV[4] == "active" then
  result = cleanList(KEYS[1], ARGV[1], rangeStart, rangeEnd, ARGV[2], false)
elseif ARGV[4] == "delayed" then
  result = cleanSet(KEYS[1], ARGV[1], rangeStart, rangeEnd, ARGV[2], limit, {"processedOn", "timestamp"})
elseif ARGV[4] == "wait" or ARGV[4] == "paused" then
  result = cleanList(KEYS[1], ARGV[1], rangeStart, rangeEnd, ARGV[2], true)
else
  result = cleanSet(KEYS[1], ARGV[1], rangeStart, rangeEnd, ARGV[2], limit, {"finishedOn"} )
end

rcall("XADD", KEYS[2], "*", "event", "cleaned", "count", result[2])

return result[1]
