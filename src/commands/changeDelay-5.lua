--[[
  Change job delay when it is in delayed set.
  Input:
    KEYS[1] delayed key
    KEYS[2] meta key
    KEYS[3] id key
    KEYS[4] marker key
    KEYS[5] events stream

    ARGV[1] delay
    ARGV[2] timestamp
    ARGV[3] the id of the job
    ARGV[4] job key

  Output:
    0 - OK
   -1 - Missing job.
   -3 - Job not in delayed set.

  Events:
    - delayed key.
]]
local rcall = redis.call

-- Includes
--- @include "includes/addDelayMarkerIfNeeded"
--- @include "includes/getOrSetMaxEvents"
--- @include "includes/isQueuePaused"

if rcall("EXISTS", ARGV[4]) == 1 then
  local jobId = ARGV[3]

  local jobCounter = rcall("INCR", KEYS[3])
  local delay = tonumber(ARGV[1])
  local delayedTimestamp = (delay > 0 and (tonumber(ARGV[2]) + delay)) or 0
  -- Bake in the job id first 12 bits into the timestamp
  -- to guarantee correct execution order of delayed jobs
  -- (up to 4096 jobs per given timestamp or 4096 jobs apart per timestamp)
  --
  -- WARNING: Jobs that are so far apart that they wrap around will cause FIFO to fail
  local score = delayedTimestamp * 0x1000 + bit.band(jobCounter, 0xfff)

  local numRemovedElements = rcall("ZREM", KEYS[1], jobId)

  if numRemovedElements < 1 then
    return -3
  end

  rcall("HSET", ARGV[4], "delay", delay)
  rcall("ZADD", KEYS[1], score, jobId)

  local maxEvents = getOrSetMaxEvents(KEYS[2])

  rcall("XADD", KEYS[5], "MAXLEN", "~", maxEvents, "*", "event", "delayed",
    "jobId", jobId, "delay", delayedTimestamp)

  -- mark that a delayed job is available
  local isPaused = isQueuePaused(KEYS[2])
  if not isPaused then
    addDelayMarkerIfNeeded(KEYS[4], KEYS[1])
  end

  return 0
else
  return -1
end