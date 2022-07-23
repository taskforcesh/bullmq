--[[
  Promotes a job that is currently "delayed" to the "waiting" state

     Input:
      KEYS[1] 'delayed'
      KEYS[2] 'wait'
      KEYS[3] 'paused'
      KEYS[4] 'meta'
      KEYS[5] 'priority'
      KEYS[6] 'event stream'

      ARGV[1]  queue.toKey('')
      ARGV[2]  jobId

     Events:
      'waiting'
]]
local rcall = redis.call;
local jobId = ARGV[2]

-- Includes
--- @include "includes/getTargetQueueList"

if rcall("ZREM", KEYS[1], jobId) == 1 then
  local priority = tonumber(rcall("HGET", ARGV[1] .. jobId, "priority")) or 0
  local target = getTargetQueueList(KEYS[4], KEYS[2], KEYS[3])

  if priority == 0 then
    -- LIFO or FIFO
    rcall("LPUSH", target, jobId)
  else
    -- Priority add
    rcall("ZADD", KEYS[5], priority, jobId)
    local count = rcall("ZCOUNT", KEYS[5], 0, priority)

    local len = rcall("LLEN", target)
    local id = rcall("LINDEX", target, len - (count - 1))
    if id then
      rcall("LINSERT", target, "BEFORE", id, jobId)
    else
      rcall("RPUSH", target, jobId)
    end
  end

  -- Emit waiting event (wait..ing@token)
  rcall("XADD", KEYS[6], "*", "event", "waiting", "jobId", jobId, "prev", "delayed");

  rcall("HSET", ARGV[1] .. jobId, "delay", 0)

  return 0
else
  return -3
end