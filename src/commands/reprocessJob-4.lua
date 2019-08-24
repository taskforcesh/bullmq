--[[
  Attempts to reprocess a job

  Input:
    KEYS[1] job key
    KEYS[2] events stream
    KEYS[3] job state
    KEYS[4] wait key

    ARGV[1] job.id,
    ARGV[2] (job.opts.lifo ? 'R' : 'L') + 'PUSH'

  Output:
    1 means the operation was a success
    0 means the job does not exist
    -2 means the job was not found in the expected set.

  Events:
    emits 'added' if succesfully moved job to wait.
]]
local rcall = redis.call;
if (rcall("EXISTS", KEYS[1]) == 1) then
  local jobId = ARGV[1]
  if (rcall("ZREM", KEYS[3], jobId) == 1) then
    rcall(ARGV[2], KEYS[4], jobId)
    rcall(ARGV[2], KEYS[4] .. ":added", jobId)

    -- Emit waiting event
    rcall("XADD", KEYS[2], "*", "event", "waiting", "jobId", jobId);
    return 1
  else
    return -2
  end
else
  return 0
end
