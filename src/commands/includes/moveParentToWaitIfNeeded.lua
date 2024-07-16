--[[
  Validate and move parent to active if needed.
]]

-- Includes
--- @include "addDelayMarkerIfNeeded"
--- @include "addJobInTargetList"
--- @include "addJobWithPriority"
--- @include "isQueuePausedOrMaxed"
--- @include "getTargetQueueList"

local function moveParentToWaitIfNeeded(parentQueueKey, parentDependenciesKey,
                                        parentKey, parentId, timestamp)
    local isParentActive = rcall("ZSCORE",
                                 parentQueueKey .. ":waiting-children", parentId)
    if rcall("SCARD", parentDependenciesKey) == 0 and isParentActive then
        rcall("ZREM", parentQueueKey .. ":waiting-children", parentId)
        local parentWaitKey = parentQueueKey .. ":wait"
        local parentPausedKey = parentQueueKey .. ":paused"
        local parentActiveKey = parentQueueKey .. ":active"
        local parentMetaKey = parentQueueKey .. ":meta"

        local parentMarkerKey = parentQueueKey .. ":marker"
        local jobAttributes = rcall("HMGET", parentKey, "priority", "delay")
        local priority = tonumber(jobAttributes[1]) or 0
        local delay = tonumber(jobAttributes[2]) or 0

        if delay > 0 then
            local delayedTimestamp = tonumber(timestamp) + delay
            local score = delayedTimestamp * 0x1000
            local parentDelayedKey = parentQueueKey .. ":delayed"
            rcall("ZADD", parentDelayedKey, score, parentId)
            rcall("XADD", parentQueueKey .. ":events", "*", "event", "delayed",
                  "jobId", parentId, "delay", delayedTimestamp)

            addDelayMarkerIfNeeded(parentMarkerKey, parentDelayedKey)
        else
            if priority == 0 then
                local parentTarget, isParentPausedOrMaxed =
                    getTargetQueueList(parentMetaKey, parentActiveKey, parentWaitKey,
                                       parentPausedKey)
                addJobInTargetList(parentTarget, parentMarkerKey, "RPUSH", isParentPausedOrMaxed,
                    parentId)
            else
                local isPausedOrMaxed = isQueuePausedOrMaxed(parentMetaKey, parentActiveKey)
                addJobWithPriority(parentMarkerKey,
                                   parentQueueKey .. ":prioritized", priority,
                                   parentId, parentQueueKey .. ":pc", isPausedOrMaxed)
            end

            rcall("XADD", parentQueueKey .. ":events", "*", "event", "waiting",
                  "jobId", parentId, "prev", "waiting-children")
        end
    end
end
