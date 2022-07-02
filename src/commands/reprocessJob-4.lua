--[[
  Attempts to reprocess a job

  Input:
    KEYS[1] job key
    KEYS[2] events stream
    KEYS[3] job state
    KEYS[4] wait key

    ARGV[1] job.id
    ARGV[2] (job.opts.lifo ? 'R' : 'L') + 'PUSH'
    ARGV[3] propVal - failedReason/returnvalue
    ARGV[4] prev state - failed/completed

  Output:
    1  means the operation was a success
    -1 means the job does not exist
    -3 means the job was not found in the expected set.
]]
local rcall = redis.call;
if (rcall("EXISTS", KEYS[1]) == 1) then
  local jobId = ARGV[1]
  if (rcall("ZREM", KEYS[3], jobId) == 1) then
    rcall(ARGV[2], KEYS[4], jobId)
    rcall("HDEL", KEYS[1], "finishedOn", "processedOn", ARGV[3])

    -- Emit waiting event
    rcall("XADD", KEYS[2], "*", "event", "waiting", "jobId", jobId, "prev", ARGV[4]);
    return 1
  else
    return -3
  end
else
  return -1
end
