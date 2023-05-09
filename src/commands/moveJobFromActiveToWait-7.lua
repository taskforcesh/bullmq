--[[
  Function to move job from active state to wait.
  Input:
    KEYS[1] active key
    KEYS[2] wait key
    
    KEYS[3] stalled key
    KEYS[4] job lock key
    KEYS[5] paused key
    KEYS[6] meta key
    KEYS[7] event key

    args[1] job id
    args[2] lock token

]]
local rcall = redis.call

-- Includes
--- @include "includes/getTargetQueueList"

local jobId = ARGV[1]
local token = ARGV[2]
local lockKey = KEYS[4]

local lockToken = rcall("GET", lockKey)
if lockToken == token then
  local removed = rcall("LREM", KEYS[1], 1, jobId)
  if (removed > 0) then
    local target = getTargetQueueList(KEYS[6], KEYS[2], KEYS[5])

    rcall("SREM", KEYS[3], jobId)
    rcall("RPUSH", target, jobId)
    rcall("DEL", lockKey)

    -- Emit waiting event
    rcall("XADD", KEYS[7], "*", "event", "waiting", "jobId", jobId)
  end
end
