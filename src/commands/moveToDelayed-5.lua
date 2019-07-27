--[[
  Moves job from active to delayed set.

  Input: 
    KEYS[1] active key
    KEYS[2] delayed key
    KEYS[3] job key
    KEYS[4] events stream
    KEYS[5] delayed stream

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

if rcall("EXISTS", KEYS[3]) == 1 then

  local score = tonumber(ARGV[1])
  local delayedTimestamp = (score / 0x1000)
  
  rcall("ZADD", KEYS[2], score, ARGV[2])
  rcall("LREM", KEYS[1], 0, ARGV[2])

  rcall("XADD", KEYS[4], "*", "event", "delayed", "jobId", jobId, "delay", delayedTimestamp);
  rcall("XADD", KEYS[5], "*", "nextTimestamp", delayedTimestamp);

  return 0
else
  return -1
end
