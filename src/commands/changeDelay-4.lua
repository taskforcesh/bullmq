--[[
  Change job delay when it is in delayed set.
  Input:
    KEYS[1] delayed key
    KEYS[2] meta key
    KEYS[3] marker key
    KEYS[4] events stream

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
--- @include "includes/getDelayedScore"
--- @include "includes/getOrSetMaxEvents"

if rcall("EXISTS", ARGV[4]) == 1 then
  local jobId = ARGV[3]

  local delay = tonumber(ARGV[1])
  local score, delayedTimestamp = getDelayedScore(KEYS[1], ARGV[2], delay)

  local numRemovedElements = rcall("ZREM", KEYS[1], jobId)

  if numRemovedElements < 1 then
    return -3
  end

  rcall("HSET", ARGV[4], "delay", delay)
  rcall("ZADD", KEYS[1], score, jobId)

  local maxEvents = getOrSetMaxEvents(KEYS[2])

  rcall("XADD", KEYS[4], "MAXLEN", "~", maxEvents, "*", "event", "delayed",
    "jobId", jobId, "delay", delayedTimestamp)

  -- mark that a delayed job is available
  addDelayMarkerIfNeeded(KEYS[3], KEYS[1])

  return 0
else
  return -1
end