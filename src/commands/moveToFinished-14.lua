--[[
  Move job from active to a finished status (completed o failed)
  A job can only be moved to completed if it was active.
  The job must be locked before it can be moved to a finished status,
  and the lock must be released in this script.

    Input:
      KEYS[1] wait key
      KEYS[2] active key
      KEYS[3] prioritized key
      KEYS[4] event stream key
      KEYS[5] stalled key

      -- Rate limiting
      KEYS[6] rate limiter key
      KEYS[7] delayed key

      KEYS[8] paused key
      KEYS[9] meta key
      KEYS[10] pc priority counter

      KEYS[11] completed/failed key
      KEYS[12] jobId key
      KEYS[13] metrics key
      KEYS[14] marker key

      ARGV[1]  jobId
      ARGV[2]  timestamp
      ARGV[3]  msg property returnvalue / failedReason
      ARGV[4]  return value / failed reason
      ARGV[5]  target (completed/failed)
      ARGV[6]  fetch next?
      ARGV[7]  keys prefix
      ARGV[8]  opts
      ARGV[9]  job fields to update

      opts - token - lock token
      opts - keepJobs
      opts - lockDuration - lock duration in milliseconds
      opts - attempts max attempts
      opts - maxMetricsSize
      opts - fpof - fail parent on fail
      opts - cpof - continue parent on fail
      opts - idof - ignore dependency on fail
      opts - rdof - remove dependency on fail
      opts - name - worker name

    Output:
      0 OK
      -1 Missing key.
      -2 Missing lock.
      -3 Job not in active set
      -4 Job has pending dependencies
      -6 Lock is not owned by this client

    Events:
      'completed/failed'
]]
local rcall = redis.call

--- Includes
--- @include "includes/collectMetrics"
--- @include "includes/getNextDelayedTimestamp"
--- @include "includes/getRateLimitTTL"
--- @include "includes/getTargetQueueList"
--- @include "includes/moveJobFromPriorityToActive"
--- @include "includes/moveChildFromDependenciesIfNeeded"
--- @include "includes/prepareJobForProcessing"
--- @include "includes/promoteDelayedJobs"
--- @include "includes/removeDeduplicationKeyIfNeededOnFinalization"
--- @include "includes/removeJobKeys"
--- @include "includes/removeJobsByMaxAge"
--- @include "includes/removeJobsByMaxCount"
--- @include "includes/removeLock"
--- @include "includes/removeParentDependencyKey"
--- @include "includes/trimEvents"
--- @include "includes/updateParentDepsIfNeeded"
--- @include "includes/updateJobFields"

local jobIdKey = KEYS[12]
if rcall("EXISTS", jobIdKey) == 1 then -- Make sure job exists
    -- Make sure it does not have pending dependencies
    -- It must happen before removing lock
    if ARGV[5] == "completed" and
        not rcall("HGET", jobIdKey, "igdp") and -- check if we should ignore this check
        rcall("SCARD", jobIdKey .. ":dependencies") ~= 0 then
        return -4
    end

    local opts = cmsgpack.unpack(ARGV[8])

    local token = opts['token']

    local errorCode = removeLock(jobIdKey, KEYS[5], token, ARGV[1])
    if errorCode < 0 then
        return errorCode
    end

    updateJobFields(jobIdKey, ARGV[9]);

    local attempts = opts['attempts']
    local maxMetricsSize = opts['maxMetricsSize']
    local maxCount = opts['keepJobs']['count']
    local maxAge = opts['keepJobs']['age']

    local jobAttributes = rcall("HMGET", jobIdKey, "parentKey", "parent", "deid")
    local parentKey = jobAttributes[1] or ""
    local parentId = ""
    local parentQueueKey = ""
    if jobAttributes[2] then -- TODO: need to revisit this logic if it's still needed
        local jsonDecodedParent = cjson.decode(jobAttributes[2])
        parentId = jsonDecodedParent['id']
        parentQueueKey = jsonDecodedParent['queueKey']
    end

    local jobId = ARGV[1]
    local timestamp = ARGV[2]

    -- Remove from active list (if not active we shall return error)
    local numRemovedElements = rcall("LREM", KEYS[2], -1, jobId)

    if (numRemovedElements < 1) then
        return -3
    end

    local eventStreamKey = KEYS[4]
    local metaKey = KEYS[9]
    -- Trim events before emiting them to avoid trimming events emitted in this script
    trimEvents(metaKey, eventStreamKey)

    local prefix = ARGV[7]

    removeDeduplicationKeyIfNeededOnFinalization(prefix, jobAttributes[3], jobId)

    -- If job has a parent we need to
    -- 1) remove this job id from parents dependencies
    -- 2) move the job Id to parent "processed" set
    -- 3) push the results into parent "results" list
    -- 4) if parent's dependencies is empty, then move parent to "wait/paused". Note it may be a different queue!.
    if parentId == "" and parentKey ~= "" then
        parentId = getJobIdFromKey(parentKey)
        parentQueueKey = getJobKeyPrefix(parentKey, ":" .. parentId)
    end

    if parentId ~= "" then
        if ARGV[5] == "completed" then
            local dependenciesSet = parentKey .. ":dependencies"
            if rcall("SREM", dependenciesSet, jobIdKey) == 1 then
                updateParentDepsIfNeeded(parentKey, parentQueueKey, dependenciesSet, parentId, jobIdKey, ARGV[4],
                    timestamp)
            end
        else
            moveChildFromDependenciesIfNeeded(jobAttributes[2], jobIdKey, ARGV[4], timestamp)
        end
    end

    local attemptsMade = rcall("HINCRBY", jobIdKey, "atm", 1)

    -- Remove job?
    if maxCount ~= 0 then
        local targetSet = KEYS[11]
        -- Add to complete/failed set
        rcall("ZADD", targetSet, timestamp, jobId)
        rcall("HSET", jobIdKey, ARGV[3], ARGV[4], "finishedOn", timestamp)
        -- "returnvalue" / "failedReason" and "finishedOn"

        if ARGV[5] == "failed" then
            rcall("HDEL", jobIdKey, "defa")
        end

        -- Remove old jobs?
        if maxAge ~= nil then
            removeJobsByMaxAge(timestamp, maxAge, targetSet, prefix)
        end

        if maxCount ~= nil and maxCount > 0 then
            removeJobsByMaxCount(maxCount, targetSet, prefix)
        end
    else
        removeJobKeys(jobIdKey)
        if parentKey ~= "" then
            -- TODO: when a child is removed when finished, result or failure in parent
            -- must not be deleted, those value references should be deleted when the parent
            -- is deleted
            removeParentDependencyKey(jobIdKey, false, parentKey, jobAttributes[3])
        end
    end

    rcall("XADD", eventStreamKey, "*", "event", ARGV[5], "jobId", jobId, ARGV[3], ARGV[4], "prev", "active")

    if ARGV[5] == "failed" then
        if tonumber(attemptsMade) >= tonumber(attempts) then
            rcall("XADD", eventStreamKey, "*", "event", "retries-exhausted", "jobId", jobId, "attemptsMade",
                attemptsMade)
        end
    end

    -- Collect metrics
    if maxMetricsSize ~= "" then
        collectMetrics(KEYS[13], KEYS[13] .. ':data', maxMetricsSize, timestamp)
    end

    -- Try to get next job to avoid an extra roundtrip if the queue is not closing,
    -- and not rate limited.
    if (ARGV[6] == "1") then

        local target, isPausedOrMaxed = getTargetQueueList(metaKey, KEYS[2], KEYS[1], KEYS[8])

        local markerKey = KEYS[14]
        -- Check if there are delayed jobs that can be promoted
        promoteDelayedJobs(KEYS[7], markerKey, target, KEYS[3], eventStreamKey, prefix, timestamp, KEYS[10],
            isPausedOrMaxed)

        local maxJobs = tonumber(opts['limiter'] and opts['limiter']['max'])
        -- Check if we are rate limited first.
        local expireTime = getRateLimitTTL(maxJobs, KEYS[6])

        if expireTime > 0 then
            return {0, 0, expireTime, 0}
        end

        -- paused or maxed queue
        if isPausedOrMaxed then
            return {0, 0, 0, 0}
        end

        jobId = rcall("RPOPLPUSH", KEYS[1], KEYS[2])

        if jobId then
            -- Markers in waitlist DEPRECATED in v5: Remove in v6.
            if string.sub(jobId, 1, 2) == "0:" then
                rcall("LREM", KEYS[2], 1, jobId)

                -- If jobId is special ID 0:delay (delay greater than 0), then there is no job to process
                -- but if ID is 0:0, then there is at least 1 prioritized job to process
                if jobId == "0:0" then
                    jobId = moveJobFromPriorityToActive(KEYS[3], KEYS[2], KEYS[10])
                    return prepareJobForProcessing(prefix, KEYS[6], eventStreamKey, jobId, timestamp, maxJobs,
                        markerKey, opts)
                end
            else
                return prepareJobForProcessing(prefix, KEYS[6], eventStreamKey, jobId, timestamp, maxJobs, markerKey,
                    opts)
            end
        else
            jobId = moveJobFromPriorityToActive(KEYS[3], KEYS[2], KEYS[10])
            if jobId then
                return prepareJobForProcessing(prefix, KEYS[6], eventStreamKey, jobId, timestamp, maxJobs, markerKey,
                    opts)
            end
        end

        -- Return the timestamp for the next delayed job if any.
        local nextTimestamp = getNextDelayedTimestamp(KEYS[7])
        if nextTimestamp ~= nil then
            -- The result is guaranteed to be positive, since the
            -- ZRANGEBYSCORE command would have return a job otherwise.
            return {0, 0, 0, nextTimestamp}
        end
    end

    local waitLen = rcall("LLEN", KEYS[1])
    if waitLen == 0 then
        local activeLen = rcall("LLEN", KEYS[2])

        if activeLen == 0 then
            local prioritizedLen = rcall("ZCARD", KEYS[3])

            if prioritizedLen == 0 then
                rcall("XADD", eventStreamKey, "*", "event", "drained")
            end
        end
    end

    return 0
else
    return -1
end
