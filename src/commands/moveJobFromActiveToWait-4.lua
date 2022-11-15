--[[
  Function to move job from wait state to active.
  Input:
    keys[1] active key
    keys[2] wait key
    
    keys[3] stalled key
    keys[4] job lock key

    args[1] job id
]]
local rcall = redis.call

local jobId = ARGV[1]
local removed = rcall("LREM", KEYS[1], 1, jobId)
if (removed > 0) then
    rcall("SREM", KEYS[3], jobId)
    rcall("RPUSH", KEYS[2], jobId);
    rcall("DEL", KEYS[4])
end
