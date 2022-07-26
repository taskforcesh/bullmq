--[[
  Retries a failed job by moving it back to the wait queue.

    Input:
      KEYS[1] 'active',
      KEYS[2] 'wait'
      KEYS[3] 'paused'
      KEYS[4] job key
      KEYS[5] 'meta'
      KEYS[6] events stream

      ARGV[1]  pushCmd
      ARGV[2]  jobId
      ARGV[3]  token

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

if rcall("EXISTS", KEYS[4]) == 1 then

  if ARGV[3] ~= "0" then
    local lockKey = KEYS[4] .. ':lock'
    if rcall("GET", lockKey) == ARGV[3] then
      rcall("DEL", lockKey)
    else
      return -2
    end
  end

  local target = getTargetQueueList(KEYS[5], KEYS[2], KEYS[3])

  rcall("LREM", KEYS[1], 0, ARGV[2])
  rcall(ARGV[1], target, ARGV[2])

  -- Emit waiting event
  rcall("XADD", KEYS[6], "*", "event", "waiting", "jobId", ARGV[2], "prev", "failed");
  
  return 0
else
  return -1
end
