--[[
  Change job priority
  Input:
    KEYS[1] 'wait',
    KEYS[2] 'paused'
    KEYS[3] 'meta'
    KEYS[4] 'priority'
    KEYS[5] 'prefix'

    ARGV[1] priority value
    ARGV[2] job key
    ARGV[3] job id
    ARGV[4] lifo

    Output:
       0  - OK
      -1  - Missing job
]]
local jobKey = ARGV[2]
local jobId = ARGV[3]
local priority = tonumber(ARGV[1])
local rcall = redis.call

-- Includes
--- @include "includes/addJobWithPriority"
--- @include "includes/getTargetQueueList"

if rcall("EXISTS", jobKey) == 1 then
  local target, paused = getTargetQueueList(KEYS[3], KEYS[1], KEYS[2])
  
  --verify last job in targetKey
  local lastJobId = rcall("LINDEX", target, -1)
  if lastJobId then
    local lastJobPriority = tonumber(rcall("HGET", KEYS[5] .. lastJobId, "priority")) or 0

    if lastJobPriority > priority and priority > 0 then
      rcall("RPOP", target)
      --re-add to priority
      rcall("ZADD", KEYS[4], lastJobPriority, lastJobId)
    end
  end

  local isPrioritized = rcall("ZREM", KEYS[4], jobId) > 0
  if isPrioritized then
    -- Priority add
    addJobWithPriority(KEYS[1], KEYS[4], priority, target, paused, jobId)
  else
    local numRemovedElements = rcall("LREM", target, -1, jobId)
    if numRemovedElements > 0 then
      -- Standard or priority add
      if priority == 0 then
        -- LIFO or FIFO
        local pushCmd = ARGV[4] == '1' and 'RPUSH' or 'LPUSH';
        rcall(pushCmd, target, jobId)
      else
        -- Priority add
        addJobWithPriority(KEYS[1], KEYS[4], priority, target, paused, jobId)
      end
    end  
  end

  rcall("HSET", jobKey, "priority", priority)

  return 0
else
  return -1
end
