--[[
  Removes job from queue after ttl.

    Input:
      KEYS[1] 'active',
      KEYS[2] 'wait'
      KEYS[3] 'paused'
      KEYS[4] job key
      KEYS[5] 'meta'
      KEYS[6] events stream
      KEYS[7] delayed key
      KEYS[8] priority key

      ARGV[1]  key prefix
      ARGV[2]  timestamp
      ARGV[3]  jobId
      ARGV[4]  token

    Events:
      'waiting'

    Output:
     0  - OK
     -1 - Missing key
     -2 - Missing lock
]]
local rcall = redis.call

-- Includes
--- @include "includes/getTargetQueueList"
--- @include "includes/promoteDelayedJobs"
--- @include "includes/removeJob"

promoteDelayedJobs(KEYS[7], KEYS[2], KEYS[8], KEYS[3], KEYS[5], KEYS[6], ARGV[1], ARGV[2])

if rcall("EXISTS", KEYS[4]) == 1 then

  if ARGV[4] ~= "0" then
    local lockKey = KEYS[4] .. ':lock'
    if rcall("GET", lockKey) == ARGV[4] then
      rcall("DEL", lockKey)
    else
      return -2
    end
  end

  local target = getTargetQueueList(KEYS[5], KEYS[2], KEYS[3])

  rcall("LREM", KEYS[1], 0, ARGV[3])
  removeJob(ARGV[3], false, ARGV[1])

  -- Emit discarded event
  rcall("XADD", KEYS[6], "*", "event", "discarded", "jobId", ARGV[3], "prev", "active");
  
  return 0
else
  return -1
end
