--[[
  Moves job from active to delayed set.

  Input:
    KEYS[1] job key
    KEYS[2] events stream
    KEYS[3] delayed stream

    ARGV[1] delayedTimestamp
    ARGV[2] the id of the job
    ARGV[3] queue token

  Output:
    0 - OK
   -1 - Missing job.

  Events:
    - delayed key.
]]
local rcall = redis.call

if rcall("EXISTS", KEYS[1]) == 1 then

  local jobId = ARGV[2]
  local score = tonumber(ARGV[1])
  local delayedTimestamp = (score / 0x1000)

  rcall("XADD", KEYS[2], "*", "event", "delayed", "jobId", jobId, "delay", delayedTimestamp);
  rcall("XADD", KEYS[3], "*", "nextTimestamp", delayedTimestamp);

  return 0
else
  return -1
end
