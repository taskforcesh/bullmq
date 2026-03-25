--[[
  Function to create a new job from stored dedup-next data
  when a deduplicated job with keepLastIfActive finishes.
  At most one next job is created per deduplication ID.
  Multiple triggers while active overwrite the dedup-next data,
  so only the latest data is used.
]]

-- Includes
--- @include "addJobInTargetList"
--- @include "getOrSetMaxEvents"
--- @include "getTargetQueueList"
--- @include "setDeduplicationKey"
--- @include "storeJob"

local function requeueDeduplicatedJob(prefix, deduplicationId, eventStreamKey,
    metaKey, activeKey, waitKey, pausedKey, markerKey, timestamp)
  local deduplicationNextKey = prefix .. "dn:" .. deduplicationId
  if rcall("EXISTS", deduplicationNextKey) == 1 then
    local nextData = rcall("HMGET", deduplicationNextKey, "name", "data", "opts")
    rcall("DEL", deduplicationNextKey)

    local newJobId = rcall("INCR", prefix .. "id") .. ""
    local newJobIdKey = prefix .. newJobId
    local newOpts = cjson.decode(nextData[3])
    local deduplicationKey = prefix .. "de:" .. deduplicationId

    -- Use storeJob to persist the job exactly as a normal add would
    storeJob(eventStreamKey, newJobIdKey, newJobId, nextData[1], nextData[2],
        newOpts, timestamp, nil, nil, nil)

    -- Set dedup key for the new job
    setDeduplicationKey(deduplicationKey, newJobId, newOpts['de'])

    -- Add to target list (wait or paused) and emit waiting event
    local maxEvents = getOrSetMaxEvents(metaKey)
    local target, isPausedOrMaxed = getTargetQueueList(metaKey, activeKey, waitKey, pausedKey)
    addJobInTargetList(target, markerKey, "LPUSH", isPausedOrMaxed, newJobId)

    rcall("XADD", eventStreamKey, "MAXLEN", "~", maxEvents, "*", "event", "waiting",
        "jobId", newJobId)
  end
end
