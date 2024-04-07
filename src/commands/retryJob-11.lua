--[[
  Retries a failed job by moving it back to the wait queue.

    Input:
      KEYS[1]  'active',
      KEYS[2]  'wait'
      KEYS[3]  'paused'
      KEYS[4]  job key
      KEYS[5]  'meta'
      KEYS[6]  events stream
      KEYS[7]  delayed key
      KEYS[8]  prioritized key
      KEYS[9]  'pc' priority counter
      KEYS[10] 'marker'
      KEYS[11] 'stalled'

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
]]
local rcall = redis.call

-- Includes
--- @include "includes/addJobWithPriority"
--- @include "includes/getOrSetMaxEvents"
--- @include "includes/getTargetQueueList"
--- @include "includes/promoteDelayedJobs"

local target, paused = getTargetQueueList(KEYS[5], KEYS[2], KEYS[3])
local markerKey = KEYS[10]

-- Check if there are delayed jobs that we can move to wait.
-- test example: when there are delayed jobs between retries
promoteDelayedJobs(KEYS[7], markerKey, target, KEYS[8], KEYS[6], ARGV[1], ARGV[2], KEYS[9], paused)

if rcall("EXISTS", KEYS[4]) == 1 then
  --TODO: to be refactored using an include
  local token = ARGV[5]
  if token ~= "0" then
    local lockKey = KEYS[4] .. ':lock'
    local lockToken = rcall("GET", lockKey)
    if locakToken == token then
      rcall("DEL", lockKey)
      rcall("SREM", KEYS[11], ARGV[4])
    else
      if lockToken then
        -- Lock exists but token does not match
        return -6
      else
        -- Lock is missing completely
        return -2
      end
    end
  end

  rcall("LREM", KEYS[1], 0, ARGV[4])

  local priority = tonumber(rcall("HGET", KEYS[4], "priority")) or 0

  -- Standard or priority add
  if priority == 0 then
    rcall(ARGV[3], target, ARGV[4])
    -- TODO: check if we need to add marker in this case too
  else
    addJobWithPriority(markerKey, KEYS[8], priority, ARGV[4], KEYS[9], paused)
  end

  rcall("HINCRBY", KEYS[4], "atm", 1)

  local maxEvents = getOrSetMaxEvents(KEYS[5])

  -- Emit waiting event
  rcall("XADD", KEYS[6], "MAXLEN", "~", maxEvents, "*", "event", "waiting",
    "jobId", ARGV[4], "prev", "failed")

  return 0
else
  return -1
end
