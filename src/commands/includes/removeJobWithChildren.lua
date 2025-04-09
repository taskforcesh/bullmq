--[[
    Remove a job from all the statuses it may be in as well as all its data,
    including its children. Active children can be ignored.

    Events:
      'removed'
]]

local rcall = redis.call

-- Includes
--- @include "destructureJobKey"
--- @include "getOrSetMaxEvents"
--- @include "isJobSchedulerJob"
--- @include "removeDeduplicationKey"
--- @include "removeJobFromAnyState"
--- @include "removeJobKeys"
--- @include "removeParentDependencyKey"
--- @include "isLocked"

local removeJobChildren
local removeJobWithChildren

removeJobChildren = function(prefix, meta, jobKey, options)
    -- Check if this job has children
    -- If so, we are going to try to remove the children recursively in a depth-first way
    -- because if some job is locked, we must exit with an error.

    if not options.ignoreProcessed then
        local processed = rcall("HGETALL", jobKey .. ":processed")
        if #processed > 0 then
            for i = 1, #processed, 2 do
                local childJobId = getJobIdFromKey(processed[i])
                local childJobPrefix = getJobKeyPrefix(processed[i], childJobId)
                removeJobWithChildren(childJobPrefix, meta, childJobId, jobKey, options)
            end
        end

        local failed = rcall("HGETALL", jobKey .. ":failed")
        if #failed > 0 then
            for i = 1, #failed, 2 do
                local childJobId = getJobIdFromKey(failed[i])
                local childJobPrefix = getJobKeyPrefix(failed[i], childJobId)
                removeJobWithChildren(childJobPrefix, meta, childJobId, jobKey, options)
            end
        end

        local unsuccessful = rcall("ZRANGE", jobKey .. ":unsuccessful", 0, -1)
        if #unsuccessful > 0 then
            for i = 1, #unsuccessful, 1 do
                local childJobId = getJobIdFromKey(unsuccessful[i])
                local childJobPrefix = getJobKeyPrefix(unsuccessful[i], childJobId)
                removeJobWithChildren(childJobPrefix, meta, childJobId, jobKey, options)
            end
        end
    end

    local dependencies = rcall("SMEMBERS", jobKey .. ":dependencies")
    if #dependencies > 0 then
        for i, childJobKey in ipairs(dependencies) do
            local childJobId = getJobIdFromKey(childJobKey)
            local childJobPrefix = getJobKeyPrefix(childJobKey, childJobId)
            removeJobWithChildren(childJobPrefix, meta, childJobId, jobKey, options)
        end
    end
end

removeJobWithChildren = function(prefix, meta, jobId, parentKey, options)
    local jobKey = prefix .. jobId

    if options.ignoreLocked then
        if isLocked(prefix, jobId) then
            return
        end
    end

    -- Check if job is in the failed zset
    local failedSet = prefix .. "failed"
    if not (options.ignoreProcessed and rcall("ZSCORE", failedSet, jobId)) then
        removeParentDependencyKey(jobKey, false, parentKey, nil)

        if options.removeChildren then
            removeJobChildren(prefix, meta, jobKey, options)
        end

        local prev = removeJobFromAnyState(prefix, jobId)
        removeDeduplicationKey(prefix, jobKey)
        if removeJobKeys(jobKey) > 0 then
            local maxEvents = getOrSetMaxEvents(meta)
            rcall("XADD", prefix .. "events", "MAXLEN", "~", maxEvents, "*", "event", "removed", "jobId", jobId, "prev", prev)
        end
    end
end
