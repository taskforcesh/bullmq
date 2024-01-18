--[[
  Promotes a job that is currently "delayed" to the "waiting" state

    Input:
      KEYS[1] 'delayed'
      KEYS[2] 'wait'
      KEYS[3] 'paused'
      KEYS[4] 'meta'
      KEYS[5] 'prioritized'
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
--- @include "includes/getTargetQueueList"

if rcall("ZREM", KEYS[1], jobId) == 1 then
    local jobKey = ARGV[1] .. jobId
    local priority = tonumber(rcall("HGET", jobKey, "priority")) or 0
    local metaKey = KEYS[4]

    -- Remove delayed "marker" from the wait list if there is any.
    -- Since we are adding a job we do not need the marker anymore.
    -- Markers in waitlist DEPRECATED in v5: Remove in v6.
    local target, paused = getTargetQueueList(metaKey, KEYS[2], KEYS[3])
    local marker = rcall("LINDEX", target, 0)
    if marker and string.sub(marker, 1, 2) == "0:" then rcall("LPOP", target) end

    if priority == 0 then
        -- LIFO or FIFO
        addJobInTargetList(target, KEYS[8], "LPUSH", paused, jobId)
    else
        addJobWithPriority(KEYS[8], KEYS[5], priority, jobId, KEYS[6], paused)
    end

    -- Emit waiting event (wait..ing@token)
    rcall("XADD", KEYS[7], "*", "event", "waiting", "jobId", jobId, "prev",
          "delayed");

    rcall("HSET", jobKey, "delay", 0)

    return 0
else
    return -3
end
