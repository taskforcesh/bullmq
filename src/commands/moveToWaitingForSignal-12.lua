--[[
  Returns a job's stored signal, or moves the active job to the delayed set
  until the signal arrives or the wait times out. Checking for the signal and
  moving the job happen atomically, so a signal stored by signalJob is never
  missed.

  Input:
    KEYS[1]  marker key
    KEYS[2]  active key
    KEYS[3]  prioritized key
    KEYS[4]  delayed key
    KEYS[5]  job key
    KEYS[6]  events stream
    KEYS[7]  meta key
    KEYS[8]  stalled key
    KEYS[9]  wait key
    KEYS[10] rate limiter key
    KEYS[11] pc priority counter
    KEYS[12] job signals key

    ARGV[1] timestamp
    ARGV[2] the id of the job
    ARGV[3] queue token
    ARGV[4] signal name
    ARGV[5] timeout in milliseconds

  Output:
    {1, data} - The signal is stored; data is its JSON payload.
    {0}       - The job was moved to delayed to wait for the signal.
    {2}       - The wait timed out without the signal.
    {-1}      - Missing job.
    {-2}      - Missing lock.
    {-3}      - Job not in active set.
    {-6}      - Lock mismatch.

  Events:
    - delayed key.
]]
local rcall = redis.call

-- Includes
--- @include "includes/addDelayMarkerIfNeeded"
--- @include "includes/getDelayedScore"
--- @include "includes/getOrSetMaxEvents"
--- @include "includes/removeLock"

local jobKey = KEYS[5]
local jobId = ARGV[2]
local name = ARGV[4]
local now = tonumber(ARGV[1])

if rcall("EXISTS", jobKey) ~= 1 then
  return {-1}
end

local data = rcall("HGET", KEYS[12], name)
if data then
  rcall("HDEL", jobKey, "swn", "swd")
  return {1, data}
end

-- Keep the original deadline when the job runs again while waiting for the
-- same signal, so the timeout is not reset by every rerun.
local deadline
if rcall("HGET", jobKey, "swn") == name then
  deadline = tonumber(rcall("HGET", jobKey, "swd"))
end
if deadline then
  if now >= deadline then
    rcall("HDEL", jobKey, "swn", "swd")
    return {2}
  end
else
  deadline = now + tonumber(ARGV[5])
end

local errorCode = removeLock(jobKey, KEYS[8], ARGV[3], jobId)
if errorCode < 0 then
  return {errorCode}
end

if rcall("LREM", KEYS[2], -1, jobId) < 1 then
  return {-3}
end

local delayedKey = KEYS[4]
local delay = deadline - now
local score, delayedTimestamp = getDelayedScore(delayedKey, now, delay)

rcall("HSET", jobKey, "delay", delay, "swn", name, "swd", deadline)
rcall("ZADD", delayedKey, score, jobId)

local maxEvents = getOrSetMaxEvents(KEYS[7])
rcall("XADD", KEYS[6], "MAXLEN", "~", maxEvents, "*", "event", "delayed",
      "jobId", jobId, "delay", delayedTimestamp)

addDelayMarkerIfNeeded(KEYS[1], delayedKey)

return {0}
