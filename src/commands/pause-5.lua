--[[
  Pauses or resumes a queue globably.

  Input:
    KEYS[1] 'wait' or 'paused''
    KEYS[2] 'paused' or 'wait'
    KEYS[3] 'meta'
    KEYS[4] 'prioritized'
    KEYS[5] events stream key

    ARGV[1] 'paused' or 'resumed'

  Event:
    publish paused or resumed event.
]]
local rcall = redis.call

-- Includes
--- @include "includes/addPriorityMarkerIfNeeded"

if rcall("EXISTS", KEYS[1]) == 1 then
  rcall("RENAME", KEYS[1], KEYS[2])
end

if ARGV[1] == "paused" then
  rcall("HSET", KEYS[3], "paused", 1)
else
  rcall("HDEL", KEYS[3], "paused")
  local priorityCount = rcall("ZCARD", KEYS[4])

  if priorityCount > 0 then
    addPriorityMarkerIfNeeded(KEYS[2])
  end
end

rcall("XADD", KEYS[5], "*", "event", ARGV[1]);
