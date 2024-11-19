--[[
  Retries a failed job by moving it back to the wait queue.

    Input:
      KEYS[1]  'active',
      KEYS[2]  'wait'
      KEYS[3]  job key
      KEYS[4]  'meta'
      KEYS[5]  events stream
      KEYS[6]  delayed key
      KEYS[7]  prioritized key
      KEYS[8]  'pc' priority counter
      KEYS[9] 'stalled'
      KEYS[10] 'marker'

      ARGV[1]  key prefix
      ARGV[2]  timestamp
      ARGV[3]  pushCmd
      ARGV[4]  jobId
      ARGV[5]  token

    Events:
      'waiting'

    Output:
     0  - OK
     -1 - Missing key
     -2 - Missing lock
     -3 - Job not in active set
]]
local rcall = redis.call

-- Includes
--- @include "includes/addJobInTargetList"
--- @include "includes/addJobWithPriority"
--- @include "includes/getOrSetMaxEvents"
--- @include "includes/promoteDelayedJobs"
--- @include "includes/removeLock"
--- @include "includes/isQueuePausedOrMaxed"

local jobKey = KEYS[3]
local metaKey = KEYS[4]
local isPausedOrMaxed = isQueuePausedOrMaxed(metaKey, KEYS[1])
local markerKey = KEYS[10]

-- Check if there are delayed jobs that we can move to wait.
-- test example: when there are delayed jobs between retries
promoteDelayedJobs(KEYS[6], markerKey, KEYS[2], KEYS[7], KEYS[5], ARGV[1], ARGV[2], KEYS[8], isPausedOrMaxed)

if rcall("EXISTS", jobKey) == 1 then
  local errorCode = removeLock(jobKey, KEYS[9], ARGV[5], ARGV[4]) 
  if errorCode < 0 then
    return errorCode
  end

  local numRemovedElements = rcall("LREM", KEYS[1], -1, ARGV[4])
  if (numRemovedElements < 1) then return -3 end

  local priority = tonumber(rcall("HGET", jobKey, "priority")) or 0

  --need to re-evaluate after removing job from active
  isPausedOrMaxed = isQueuePausedOrMaxed(metaKey, KEYS[1])

  -- Standard or priority add
  if priority == 0 then
    addJobInTargetList(KEYS[2], markerKey, ARGV[3], isPausedOrMaxed, ARGV[4])
  else
    addJobWithPriority(markerKey, KEYS[7], priority, ARGV[4], KEYS[8], isPausedOrMaxed)
  end

  rcall("HINCRBY", jobKey, "atm", 1)

  local maxEvents = getOrSetMaxEvents(metaKey)

  -- Emit waiting event
  rcall("XADD", KEYS[5], "MAXLEN", "~", maxEvents, "*", "event", "waiting",
    "jobId", ARGV[4], "prev", "failed")

  return 0
else
  return -1
end
