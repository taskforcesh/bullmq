--[[
  Adds a delayed job to the queue by doing the following:
    - Creates a new job key with the job data.
    - adds to delayed zset.
    - Emits a global event 'delayed' if the job is delayed.
]]

-- Includes
--- @include "addDelayMarkerIfNeeded"
--- @include "getDelayedScore"
--- @include "storeJob"

local function addDelayedJob(jobIdKey, jobId, delayedKey, eventsKey, name, data, opts, timestamp, repeatJobKey,
  maxEvents, markerKey, parentKey, parentData)
  -- Store the job.
  local delay, priority = storeJob(eventsKey, jobIdKey, jobId, name, data,
    opts, timestamp, parentKey, parentData, repeatJobKey)

  local score, delayedTimestamp = getDelayedScore(delayedKey, timestamp, tonumber(delay))

  rcall("ZADD", delayedKey, score, jobId)
  rcall("XADD", eventsKey, "MAXLEN", "~", maxEvents, "*", "event", "delayed",
    "jobId", jobId, "delay", delayedTimestamp)

  -- mark that a delayed job is available
  addDelayMarkerIfNeeded(markerKey, delayedKey)
end
  