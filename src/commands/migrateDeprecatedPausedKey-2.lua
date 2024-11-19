--[[
  Move paused job ids to wait state to repair these states

  Input:
    KEYS[1] paused key
    KEYS[2] wait key
]]

local rcall = redis.call

local hasJobsInPaused = rcall("EXISTS", KEYS[1]) == 1

if hasJobsInPaused then
    rcall("RENAME", KEYS[1], KEYS[2])
end

return 0
 