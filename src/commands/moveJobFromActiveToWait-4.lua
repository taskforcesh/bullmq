--[[
  Function to move job from active state to wait.
  Input:
    keys[1] active key
    keys[2] wait key
    
    keys[3] stalled key
    keys[4] job lock key

    args[1] job id
    args[2] lock token

]]
local rcall = redis.call

local jobId = ARGV[1]
local token = ARGV[2]
local lockKey = KEYS[4]

local lockToken = rcall("GET", lockKey)
if lockToken == token then
  local removed = rcall("LREM", KEYS[1], 1, jobId)
  if (removed > 0) then
    rcall("SREM", KEYS[3], jobId)
    rcall("RPUSH", KEYS[2], jobId);
    rcall("DEL", lockKey)
  end
end
