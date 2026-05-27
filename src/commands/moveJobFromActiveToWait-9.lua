--[[
  Function to move job from active state to wait.
  Input:
    KEYS[1]  active key
    KEYS[2]  wait key
    
    KEYS[3]  stalled key
    KEYS[4]  paused key
    KEYS[5]  meta key
    KEYS[6]  limiter key
    KEYS[7]  prioritized key
    KEYS[8]  marker key
    KEYS[9]  event key

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
--- @include "includes/removeLock"

local jobId = ARGV[1]
local token = ARGV[2]
local jobKey = ARGV[3]

if rcall("EXISTS", jobKey) == 0 then
  return -1
end

local errorCode = removeLock(jobKey, KEYS[3], token, jobId)
if errorCode < 0 then
  return errorCode
end

local metaKey = KEYS[5]
local removed = rcall("LREM", KEYS[1], 1, jobId)
if removed > 0 then
  local target, isPausedOrMaxed = getTargetQueueList(metaKey, KEYS[1], KEYS[2], KEYS[4])

  local priority = tonumber(rcall("HGET", ARGV[3], "priority")) or 0

  if priority > 0 then
    pushBackJobWithPriority(KEYS[7], priority, jobId)
  else
    addJobInTargetList(target, KEYS[8], "RPUSH", isPausedOrMaxed, jobId)
  end

  local maxEvents = getOrSetMaxEvents(metaKey)

  -- Emit waiting event
  rcall("XADD", KEYS[9], "MAXLEN", "~", maxEvents, "*", "event", "waiting",
    "jobId", jobId, "prev", "active")
end

local pttl = rcall("PTTL", KEYS[6])

if pttl > 0 then
  return pttl
else
  return 0
end
