--[[
  Promotes a job that is currently "delayed" to the "waiting" state

    Input:
      KEYS[1] 'delayed'
      KEYS[2] 'wait'
      KEYS[3] 'meta'
      KEYS[4] 'prioritized'
      KEYS[5] 'active'
      KEYS[6] 'pc' priority counter
      KEYS[7] 'event stream'
      KEYS[8] 'marker'

      ARGV[1]  queue.toKey('')
      ARGV[2]  jobId

    Output:
       0 - OK
      -3 - Job not in delayed zset.

    Events:
      'waiting'
]]
local rcall = redis.call
local jobId = ARGV[2]

-- Includes
--- @include "includes/addJobInTargetList"
--- @include "includes/addJobWithPriority"
--- @include "includes/isQueuePausedOrMaxed"

if rcall("ZREM", KEYS[1], jobId) == 1 then
    local jobKey = ARGV[1] .. jobId
    local priority = tonumber(rcall("HGET", jobKey, "priority")) or 0
    local metaKey = KEYS[3]
    local markerKey = KEYS[8]

    local isPausedOrMaxed = isQueuePausedOrMaxed(metaKey, KEYS[5])

    if priority == 0 then
        -- LIFO or FIFO
        addJobInTargetList(KEYS[2], markerKey, "LPUSH", isPausedOrMaxed, jobId)
    else
        addJobWithPriority(markerKey, KEYS[4], priority, jobId, KEYS[6], isPausedOrMaxed)
    end

    -- Emit waiting event (wait..ing@token)
    rcall("XADD", KEYS[7], "*", "event", "waiting", "jobId", jobId, "prev",
          "delayed");

    rcall("HSET", jobKey, "delay", 0)

    return 0
else
    return -3
end
