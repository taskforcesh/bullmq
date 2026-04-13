--[[
    Remove a job from all the statuses it may be in as well as all its data,
    including its children. Active children can be ignored.

    The traversal is done iteratively using an explicit stack to avoid Lua
    recursion limits when dealing with deep flow hierarchies (see #2431).

    Events:
      'removed'
]]

local rcall = redis.call

-- Includes
--- @include "destructureJobKey"
--- @include "getOrSetMaxEvents"
--- @include "isJobSchedulerJob"
--- @include "removeDeduplicationKeyIfNeededOnRemoval"
--- @include "removeJobFromAnyState"
--- @include "removeJobKeys"
--- @include "removeParentDependencyKey"
--- @include "isLocked"

local removeSingleJob
local collectDescendants
local removeJobChildren
local removeJobWithChildren

-- Remove the data associated with a single job. Assumes children (if any)
-- have already been handled by the caller.
removeSingleJob = function(prefix, jobId, parentKey, options)
    local jobKey = prefix .. jobId

    if options.ignoreLocked then
        if isLocked(prefix, jobId) then
            return false
        end
    end

    -- Check if job is in the failed zset
    local failedSet = prefix .. "failed"
    if options.ignoreProcessed and rcall("ZSCORE", failedSet, jobId) then
        return false
    end

    removeParentDependencyKey(jobKey, false, parentKey, nil)

    local prev = removeJobFromAnyState(prefix, jobId)
    local deduplicationId = rcall("HGET", jobKey, "deid")
    removeDeduplicationKeyIfNeededOnRemoval(prefix, jobId, deduplicationId)
    if removeJobKeys(jobKey) > 0 then
        local metaKey = prefix .. "meta"
        local maxEvents = getOrSetMaxEvents(metaKey)
        rcall("XADD", prefix .. "events", "MAXLEN", "~", maxEvents, "*",
            "event", "removed", "jobId", jobId, "prev", prev)
    end

    return true
end

-- Append children of jobKey to the provided stack as {prefix, jobId, parentKey}
-- entries so they can be processed iteratively.
collectDescendants = function(prefix, jobKey, options, stack)
    if not options.ignoreProcessed then
        local processed = rcall("HGETALL", jobKey .. ":processed")
        if #processed > 0 then
            for i = 1, #processed, 2 do
                local childJobId = getJobIdFromKey(processed[i])
                local childJobPrefix = getJobKeyPrefix(processed[i], childJobId)
                stack[#stack + 1] = { childJobPrefix, childJobId, jobKey }
            end
        end

        local failed = rcall("HGETALL", jobKey .. ":failed")
        if #failed > 0 then
            for i = 1, #failed, 2 do
                local childJobId = getJobIdFromKey(failed[i])
                local childJobPrefix = getJobKeyPrefix(failed[i], childJobId)
                stack[#stack + 1] = { childJobPrefix, childJobId, jobKey }
            end
        end

        local unsuccessful = rcall("ZRANGE", jobKey .. ":unsuccessful", 0, -1)
        if #unsuccessful > 0 then
            for i = 1, #unsuccessful, 1 do
                local childJobId = getJobIdFromKey(unsuccessful[i])
                local childJobPrefix = getJobKeyPrefix(unsuccessful[i], childJobId)
                stack[#stack + 1] = { childJobPrefix, childJobId, jobKey }
            end
        end
    end

    local dependencies = rcall("SMEMBERS", jobKey .. ":dependencies")
    if #dependencies > 0 then
        for i, childJobKey in ipairs(dependencies) do
            local childJobId = getJobIdFromKey(childJobKey)
            local childJobPrefix = getJobKeyPrefix(childJobKey, childJobId)
            stack[#stack + 1] = { childJobPrefix, childJobId, jobKey }
        end
    end
end

-- Iteratively remove all the children of jobKey (but not the job itself).
-- Used by removeUnprocessedChildren as well as internally when removing
-- a parent job.
removeJobChildren = function(prefix, jobKey, options)
    -- First pass: traverse the tree iteratively, collecting every descendant
    -- in pre-order so we can remove them bottom-up in the second pass.
    local discovered = {}
    local stack = {}
    collectDescendants(prefix, jobKey, options, stack)

    while #stack > 0 do
        local entry = stack[#stack]
        stack[#stack] = nil

        local childPrefix = entry[1]
        local childJobId = entry[2]

        -- Preserve the short-circuit behavior of the original recursive
        -- implementation: if a node is locked or marked as ignored, skip
        -- it entirely and do not descend into its subtree. This keeps
        -- parent dependency bookkeeping intact for active branches.
        if options.ignoreLocked and isLocked(childPrefix, childJobId) then
            -- skip this node and its descendants
        else
            local failedSet = childPrefix .. "failed"
            if options.ignoreProcessed and rcall("ZSCORE", failedSet, childJobId) then
                -- skip this node and its descendants
            else
                discovered[#discovered + 1] = entry
                local childJobKey = childPrefix .. childJobId
                collectDescendants(childPrefix, childJobKey, options, stack)
            end
        end
    end

    -- Second pass: remove descendants deepest-first so that parent
    -- dependency bookkeeping remains consistent.
    for i = #discovered, 1, -1 do
        local entry = discovered[i]
        removeSingleJob(entry[1], entry[2], entry[3], options)
    end
end

removeJobWithChildren = function(prefix, jobId, parentKey, options)
    local jobKey = prefix .. jobId

    if options.ignoreLocked then
        if isLocked(prefix, jobId) then
            return
        end
    end

    local failedSet = prefix .. "failed"
    if options.ignoreProcessed and rcall("ZSCORE", failedSet, jobId) then
        return
    end

    if options.removeChildren then
        removeJobChildren(prefix, jobKey, options)
    end

    -- Finally, remove the root job itself. Children have already been
    -- processed iteratively above.
    removeParentDependencyKey(jobKey, false, parentKey, nil)

    local prev = removeJobFromAnyState(prefix, jobId)
    local deduplicationId = rcall("HGET", jobKey, "deid")
    removeDeduplicationKeyIfNeededOnRemoval(prefix, jobId, deduplicationId)
    if removeJobKeys(jobKey) > 0 then
        local metaKey = prefix .. "meta"
        local maxEvents = getOrSetMaxEvents(metaKey)
        rcall("XADD", prefix .. "events", "MAXLEN", "~", maxEvents, "*",
            "event", "removed", "jobId", jobId, "prev", prev)
    end
end
