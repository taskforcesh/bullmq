--[[
    Remove a job from all the queues it may be in as well as all its data.
    In order to be able to remove a job, it cannot be active.

     Input:
      KEYS[1] 'active',
      KEYS[2] 'wait',
      KEYS[3] 'delayed',
      KEYS[4] 'paused',
      KEYS[5] 'completed',
      KEYS[6] 'failed',
      KEYS[7] 'priority',
      KEYS[8] jobId
      KEYS[9] job logs
      KEYS[10] events stream
      KEYS[11] queue prefix

      ARGV[1]  jobId

     Events:
      'removed'
]]

local rcall = redis.call
local jobId = ARGV[1]

local jobName = rcall("HGET", KEYS[8], "name")

rcall("LREM", KEYS[1], 0, jobId)
rcall("LREM", KEYS[2], 0, jobId)
rcall("ZREM", KEYS[3], jobId)
rcall("LREM", KEYS[4], 0, jobId)
rcall("ZREM", KEYS[5], jobId)
rcall("ZREM", KEYS[6], jobId)
rcall("ZREM", KEYS[7], jobId)
rcall("DEL", KEYS[8])
rcall("DEL", KEYS[9])
rcall("SREM", KEYS[11] .. ":" .. jobName, jobId)

rcall("XADD", KEYS[10], "*", "event", "removed", "jobId", jobId, "prev", "TBD");

return 1
