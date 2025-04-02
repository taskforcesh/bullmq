--[[
    Remove a job from all the statuses it may be in as well as all its data,
    including its children. Active children can be ignored.

    Input:
      KEYS[1] queue prefix
      KEYS[2] meta key
      KEYS[3] repeat key

      ARGV[1] jobId
      ARGV[2] remove children

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

local removeJobChildren
local removeJobWithChildren
removeJobChildren = function(prefix, jobKey, parentKey)
    -- Check if this job has children
    -- If so, we are going to try to remove the children recursively in deep first way because
    -- if some job is locked we must exit with and error.
    -- local countProcessed = rcall("HLEN", jobKey .. ":processed")
    local processed = rcall("HGETALL", jobKey .. ":processed")
    local removeChildren = "1"

    if (#processed > 0) then
        for i = 1, #processed, 2 do
            local childJobId = getJobIdFromKey(processed[i])
            local childJobPrefix = getJobKeyPrefix(processed[i], childJobId)
            removeJobWithChildren(childJobPrefix, childJobId, jobKey, removeChildren)
        end
    end

    local dependencies = rcall("SMEMBERS", jobKey .. ":dependencies")
    if (#dependencies > 0) then
        for i, childJobKey in ipairs(dependencies) do
            -- We need to get the jobId for this job.
            local childJobId = getJobIdFromKey(childJobKey)
            local childJobPrefix = getJobKeyPrefix(childJobKey, childJobId)
            removeJobWithChildren(childJobPrefix, childJobId, jobKey, removeChildren)
        end
    end

    local failed = rcall("HGETALL", jobKey .. ":failed")

    if (#failed > 0) then
        for i = 1, #failed, 2 do
            local childJobId = getJobIdFromKey(failed[i])
            local childJobPrefix = getJobKeyPrefix(failed[i], childJobId)
            removeJobWithChildren(childJobPrefix, childJobId, jobKey, removeChildren)
        end
    end

    local unsuccessful = rcall("ZRANGE", jobKey .. ":unsuccessful", 0, -1)

    if (#unsuccessful > 0) then
        for i = 1, #unsuccessful, 1 do
            local childJobId = getJobIdFromKey(unsuccessful[i])
            local childJobPrefix = getJobKeyPrefix(unsuccessful[i], childJobId)
            removeJobWithChildren(childJobPrefix, childJobId, jobKey, removeChildren)
        end
    end
end


removeJobWithChildren = function(prefix, jobId, parentKey, removeChildren)
    local jobKey = prefix .. jobId;

    removeParentDependencyKey(jobKey, false, parentKey, nil)

    if removeChildren == "1" then
        removeJobChildren(prefix, jobKey, parentKey)
    end

    local prev = removeJobFromAnyState(prefix, jobId)

    removeDeduplicationKey(prefix, jobKey)
    if removeJobKeys(jobKey) > 0 then
        local maxEvents = getOrSetMaxEvents(KEYS[2])
        rcall("XADD", prefix .. "events", "MAXLEN", "~", maxEvents, "*", "event", "removed", "jobId", jobId, "prev",
            prev)
    end
end

