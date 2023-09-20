--[[
  Change job delay when it is in delayed set.
  Input:
    KEYS[1] delayed key
    KEYS[2] job key
    KEYS[3] events stream

    ARGV[1] delay
    ARGV[2] delayedTimestamp
    ARGV[3] the id of the job
  Output:
    0 - OK
   -1 - Missing job.
   -3 - Job not in delayed set.

  Events:
    - delayed key.
]]
local rcall = redis.call

if rcall("EXISTS", KEYS[2]) == 1 then
  local jobId = ARGV[3]
  local score = tonumber(ARGV[2])
  local delayedTimestamp = (score / 0x1000)

  local numRemovedElements = rcall("ZREM", KEYS[1], jobId)

  if numRemovedElements < 1 then
    return -3
  end

  rcall("HSET", KEYS[2], "delay", tonumber(ARGV[1]))
  rcall("ZADD", KEYS[1], score, jobId)

  rcall("XADD", KEYS[3], "*", "event", "delayed", "jobId", jobId, "delay", delayedTimestamp)

  return 0
else
  return -1
end