--[[
    Remove a job from all the queues it may be in as well as all its data.
    In order to be able to remove a job, it cannot be active.

     Input:
      KEYS[1] jobId
      ARGV[1]  jobId

     Events:
      'removed'
]]

local rcall = redis.call

local getJobIdFromKey = function (jobKey)
    return string.match(jobKey, ".*:(.*)")
end

local getJobKeyPrefix = function (jobKey, jobId)
    return string.sub(jobKey, 0, #jobKey - #jobId)
end

-- recursively check if there are no locks on the
-- jobs to be removed.
local function isLocked( prefix, jobId)
    local jobKey = prefix .. jobId;

    -- Check if this job is locked
    local lockKey = jobKey .. ':lock'
    local lock = rcall("GET", lockKey)
    if not lock then
        local dependencies = rcall("SMEMBERS", jobKey .. ":dependencies")
        if (#dependencies > 0) then
            for i, childJobKey in ipairs(dependencies) do
                -- We need to get the jobId for this job.
                local childJobId = getJobIdFromKey(childJobKey)
                local childJobPrefix = getJobKeyPrefix(childJobKey, childJobId)
                local result = isLocked( childJobPrefix, childJobId )
                if result then
                    return true
                end
            end
        end
        return false
    end
    return true
end

local function removeJob( prefix, jobId)
    local jobKey = prefix .. jobId;

    -- Check if this job has a parent. If so we will just remove it from
    -- the parent child list, but if it is the last child we should move the parent to "wait/paused" 
    -- which requires code from "moveToFinished"
    local parentKey = rcall("HGET", jobKey, "parentKey")
    if( (type(parentKey) == "string") and (rcall("EXISTS", parentKey) == 1)) then
        local parentDependenciesKey = parentKey .. ":dependencies"
        local result = rcall("SREM", parentDependenciesKey, jobKey)
        if rcall("SCARD", parentDependenciesKey) == 0 then 
            local parentId = getJobIdFromKey(parentKey)
            local parentPrefix = getJobKeyPrefix(parentKey, parentId)

            rcall("ZREM", parentPrefix .. "waiting-children", parentId)

            if rcall("HEXISTS", parentPrefix .. "meta", "paused") ~= 1 then
                rcall("RPUSH", parentPrefix .. "wait", parentId)
            else
                rcall("RPUSH", parentPrefix .. "parentPrefixpaused", parentId)
            end

            local parentEventStream = parentPrefix .. "events"
            rcall("XADD", parentEventStream, "*", "event", "active", "jobId", parentId, "prev", "waiting-children")
        end
    end

    rcall("LREM", prefix .. "active", 0, jobId)
    rcall("LREM", prefix .. "wait", 0, jobId)
    rcall("ZREM", prefix .. "delayed", jobId)
    rcall("LREM", prefix .. "paused", 0, jobId)
    rcall("ZREM", prefix .. "completed", jobId)
    rcall("ZREM", prefix .. "failed", jobId)
    rcall("ZREM", prefix .. "priority", jobId)
    rcall("ZREM", prefix .. "waiting-children", jobId)
    rcall("DEL", jobKey)
    rcall("DEL", jobKey .. ":logs")

    -- Check if this job has children
    -- If so, we are going to try to remove the children recursively in deep first way because
    -- if some job is locked we must exit with and error.
    local dependencies = rcall("SMEMBERS", jobKey .. ":dependencies")
    if (#dependencies > 0) then
        for i, childJobKey in ipairs(dependencies) do
            -- We need to get the jobId for this job.
            local childJobId = getJobIdFromKey(childJobKey)
            local childJobPrefix = getJobKeyPrefix(childJobKey, childJobId)
            removeJob( childJobPrefix, childJobId )
        end
    end

    rcall("DEL", jobKey .. ":dependencies")

    -- -- delete keys related to rate limiter
        -- local limiterIndexTable = KEYS[10] .. ":index"
        -- local limitedSetKey = rcall("HGET", limiterIndexTable, jobId)
        -- if limitedSetKey then
        --     rcall("SREM", limitedSetKey, jobId)
        --     rcall("HDEL", limiterIndexTable, jobId)
    -- end

    rcall("XADD", prefix .. "events", "*", "event", "removed", "jobId", jobId, "prev", "unknown");
end

local prefix = getJobKeyPrefix(KEYS[1], ARGV[1])

if not isLocked(prefix, ARGV[1]) then
    removeJob(prefix, ARGV[1])
    return 1
end
return 0
