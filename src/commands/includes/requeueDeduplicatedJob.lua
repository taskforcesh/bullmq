--[[
  Function to create a new job from stored dedup-next data
  when a deduplicated job with keepLastIfActive finishes.
  At most one next job is created per deduplication ID.
  Multiple triggers while active overwrite the dedup-next data,
  so only the latest data is used.
]]

-- Includes
--- @include "addBaseMarkerIfNeeded"
--- @include "getOrSetMaxEvents"
--- @include "getTargetQueueList"

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

    -- Store the job
    rcall("HMSET", newJobIdKey,
        "name", nextData[1],
        "data", nextData[2],
        "opts", nextData[3],
        "timestamp", timestamp,
        "delay", 0,
        "priority", newOpts['priority'] or 0,
        "deid", deduplicationId)

    -- Set dedup key for the new job
    local deTtl = newOpts['de'] and newOpts['de']['ttl']
    if deTtl and deTtl > 0 then
      rcall('SET', deduplicationKey, newJobId, 'PX', deTtl)
    else
      rcall('SET', deduplicationKey, newJobId)
    end

    -- Add to wait list
    local maxEvents = getOrSetMaxEvents(metaKey)
    local target, isPausedOrMaxed = getTargetQueueList(metaKey, activeKey, waitKey, pausedKey)
    rcall("LPUSH", target, newJobId)
    addBaseMarkerIfNeeded(markerKey, isPausedOrMaxed)

    -- Emit events
    rcall("XADD", eventStreamKey, "*", "event", "added", "jobId", newJobId, "name", nextData[1])
    rcall("XADD", eventStreamKey, "MAXLEN", "~", maxEvents, "*", "event", "waiting",
        "jobId", newJobId)
  end
end
