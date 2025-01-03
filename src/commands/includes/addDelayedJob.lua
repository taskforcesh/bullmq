--[[
  Add marker if needed when a job is available.
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
  