--[[
  Function to move job from active state to wait.
  Input:
    KEYS[1]  active key
    KEYS[2]  wait key
    
    KEYS[3]  stalled key
    KEYS[4]  job lock key
    KEYS[5]  paused key
    KEYS[6]  meta key
    KEYS[7]  limiter key
    KEYS[8]  prioritized key
    KEYS[9]  marker key
    KEYS[10] event key

    ARGV[1] job id
    ARGV[2] lock token
    ARGV[3] job id key
]]
local rcall = redis.call

-- Includes
--- @include "includes/addJobInTargetList"
--- @include "includes/pushBackJobWithPriority"
--- @include "includes/getOrSetMaxEvents"
--- @include "includes/getTargetQueueList"

local jobId = ARGV[1]
local token = ARGV[2]
local lockKey = KEYS[4]

local lockToken = rcall("GET", lockKey)
local pttl = rcall("PTTL", KEYS[7])
if lockToken == token then
  local metaKey = KEYS[6]
  local removed = rcall("LREM", KEYS[1], 1, jobId)
  if removed > 0 then
    local target, isPausedOrMaxed = getTargetQueueList(metaKey, KEYS[1], KEYS[2], KEYS[5])

    rcall("SREM", KEYS[3], jobId)

    local priority = tonumber(rcall("HGET", ARGV[3], "priority")) or 0

    if priority > 0 then
      pushBackJobWithPriority(KEYS[8], priority, jobId)
    else
      addJobInTargetList(target, KEYS[9], "RPUSH", isPausedOrMaxed, jobId)
    end

    rcall("DEL", lockKey)

    local maxEvents = getOrSetMaxEvents(metaKey)

    -- Emit waiting event
    rcall("XADD", KEYS[10], "MAXLEN", "~", maxEvents, "*", "event", "waiting",
      "jobId", jobId)
  end
end

return pttl
