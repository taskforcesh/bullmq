--[[
    Remove a job from all the queues it may be in as well as all its data.
    In order to be able to remove a job, it cannot be active.

    Input:
      KEYS[1] queue prefix
      ARGV[1] jobId

    Events:
      'removed'
]]

local rcall = redis.call

-- Includes
--- @include "includes/destructureJobKey"
--- @include "includes/isLocked"
--- @include "includes/removeJobFromAnyState"
--- @include "includes/removeParentDependencyKey"

local function removeJob( prefix, jobId, parentKey)
    local jobKey = prefix .. jobId;

    removeParentDependencyKey(jobKey, false, parentKey)

    -- Check if this job has children
    -- If so, we are going to try to remove the children recursively in deep first way because
    -- if some job is locked we must exit with and error.
    --local countProcessed = rcall("HLEN", jobKey .. ":processed")
    local processed = rcall("HGETALL", jobKey .. ":processed")

    if (#processed > 0) then
        for i = 1, #processed, 2 do
            local childJobId = getJobIdFromKey(processed[i])
            local childJobPrefix = getJobKeyPrefix(processed[i], childJobId)
            removeJob( childJobPrefix, childJobId, jobKey )
        end
    end

    local dependencies = rcall("SMEMBERS", jobKey .. ":dependencies")
    if (#dependencies > 0) then
        for i, childJobKey in ipairs(dependencies) do
            -- We need to get the jobId for this job.
            local childJobId = getJobIdFromKey(childJobKey)
            local childJobPrefix = getJobKeyPrefix(childJobKey, childJobId)
            removeJob( childJobPrefix, childJobId, jobKey )
        end
    end

    local prev = removeJobFromAnyState(prefix, jobId)

    rcall("ZREM", prefix .. "priority", jobId)
    rcall("DEL", jobKey, jobKey .. ":logs", jobKey .. ":dependencies", jobKey .. ":processed")

    -- -- delete keys related to rate limiter
        -- local limiterIndexTable = KEYS[10] .. ":index"
        -- local limitedSetKey = rcall("HGET", limiterIndexTable, jobId)
        -- if limitedSetKey then
        --     rcall("SREM", limitedSetKey, jobId)
        --     rcall("HDEL", limiterIndexTable, jobId)
    -- end

    rcall("XADD", prefix .. "events", "*", "event", "removed", "jobId", jobId, "prev", prev);
end

local prefix = KEYS[1]

if not isLocked(prefix, ARGV[1]) then
    removeJob(prefix, ARGV[1])
    return 1
end
return 0
