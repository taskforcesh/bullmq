--[[
  Stores a signal on a job and, if the job is delayed waiting for that
  signal, moves it back to wait (or prioritized) in the same operation.

    Input:
      KEYS[1]  job key
      KEYS[2]  job signals key
      KEYS[3]  'delayed'
      KEYS[4]  'wait'
      KEYS[5]  'paused'
      KEYS[6]  'meta'
      KEYS[7]  'prioritized'
      KEYS[8]  'active'
      KEYS[9]  'pc' priority counter
      KEYS[10] 'event stream'
      KEYS[11] 'marker'

      ARGV[1]  job id
      ARGV[2]  signal name
      ARGV[3]  signal data (JSON)

    Output:
       1 - Signal stored and the job was woken up.
       0 - Signal stored; the job was not waiting for it.
      -1 - Missing job.
     -12 - Job already finished.

    Events:
      'signaled', and 'waiting' when the job is woken up.
]]
local rcall = redis.call
local jobKey = KEYS[1]
local jobId = ARGV[1]
local name = ARGV[2]

-- Includes
--- @include "includes/addJobInTargetList"
--- @include "includes/addJobWithPriority"
--- @include "includes/getOrSetMaxEvents"
--- @include "includes/isQueuePausedOrMaxed"

if rcall("EXISTS", jobKey) ~= 1 then
  return -1
end

if rcall("HEXISTS", jobKey, "finishedOn") == 1 then
  return -12
end

rcall("HSET", KEYS[2], name, ARGV[3])

local metaKey = KEYS[6]
local maxEvents = getOrSetMaxEvents(metaKey)
rcall("XADD", KEYS[10], "MAXLEN", "~", maxEvents, "*", "event", "signaled",
      "jobId", jobId, "name", name)

-- Only wake the job when it is delayed waiting for this very signal, so a
-- backoff, a scheduled start or a wait for another signal is never skipped.
if rcall("HGET", jobKey, "swn") == name and rcall("ZREM", KEYS[3], jobId) == 1 then
  local priority = tonumber(rcall("HGET", jobKey, "priority")) or 0
  local markerKey = KEYS[11]
  local isPausedOrMaxed = isQueuePausedOrMaxed(metaKey, KEYS[8])

  if priority == 0 then
    addJobInTargetList(KEYS[4], markerKey, "LPUSH", isPausedOrMaxed, jobId)
  else
    addJobWithPriority(markerKey, KEYS[7], priority, jobId, KEYS[9], isPausedOrMaxed)
  end

  rcall("XADD", KEYS[10], "MAXLEN", "~", maxEvents, "*", "event", "waiting",
        "jobId", jobId, "prev", "delayed")
  rcall("HSET", jobKey, "delay", 0)
  return 1
end

return 0
