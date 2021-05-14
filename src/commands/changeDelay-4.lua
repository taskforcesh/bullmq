--[[
  Moves job from active to delayed set.

  Input:
    KEYS[1] delayed key
    KEYS[2] job key
    KEYS[3] events stream
    KEYS[4] delayed stream

    ARGV[1] delayedTimestamp
    ARGV[2] the id of the job
    ARGV[3] queue token

  Output:
    0 - OK
   -1 - Missing job.
   -1 - Job not in delayed set.

  Events:
    - delayed key.
]]
local rcall = redis.call

if rcall("EXISTS", KEYS[2]) == 1 then

  local jobId = ARGV[2]
  local score = tonumber(ARGV[1])
  local delayedTimestamp = (score / 0x1000)

  if redis.call("ZSCORE", KEYS[1], jobId) ~= false then
    return -3
  end

  rcall("XADD", KEYS[3], "*", "event", "delayed", "jobId", jobId, "delay", delayedTimestamp);
  rcall("XADD", KEYS[4], "*", "nextTimestamp", delayedTimestamp);

  return 0
else
  return -1
end
