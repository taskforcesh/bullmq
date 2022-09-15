--[[
  Move job from active to a finished status (completed o failed)
  A job can only be moved to completed if it was active.
  The job must be locked before it can be moved to a finished status,
  and the lock must be released in this script.

    Input:
      KEYS[1] wait key
      KEYS[2] active key
      KEYS[3] priority key
      KEYS[4] event stream key
      KEYS[5] stalled key

      -- Rate limiting
      KEYS[6] rate limiter key
      KEYS[7] delayed key

      -- Delay events
      KEYS[8] delay stream key

      KEYS[9] completed/failed key
      KEYS[10] jobId key
      KEYS[11] meta key
      KEYS[12] metrics key

      ARGV[1]  jobId
      ARGV[2]  timestamp
      ARGV[3]  msg property
      ARGV[4]  return value / failed reason
      ARGV[5]  target (completed/failed)
      ARGV[6]  event data (? maybe just send jobid).
      ARGV[7]  fetch next?
      ARGV[8]  keys prefix
      ARGV[9] opts

      opts - token - lock token
      opts - keepJobs
      opts - lockDuration - lock duration in milliseconds
      opts - parent - parent data
      opts - parentKey
      opts - attempts max attempts
      opts - attemptsMade
      opts - maxMetricsSize

    Output:
      0 OK
      -1 Missing key.
      -2 Missing lock.
      -3 Job not in active set
      -4 Job has pending dependencies

    Events:
      'completed/failed'
]]
local rcall = redis.call

--- Includes
--- @include "includes/destructureJobKey"
--- @include "includes/moveJobFromWaitToActive"
--- @include "includes/removeJobsByMaxAge"
--- @include "includes/removeJobsByMaxCount"
--- @include "includes/trimEvents"
--- @include "includes/updateParentDepsIfNeeded"
--- @include "includes/collectMetrics"

local jobIdKey = KEYS[10]
if rcall("EXISTS", jobIdKey) == 1 then -- // Make sure job exists
    local opts = cmsgpack.unpack(ARGV[9])

    local token = opts['token']
    local parentId = opts['parent'] and opts['parent']['id'] or ""
    local parentQueueKey = opts['parent'] and opts['parent']['queue'] or ""
    local parentKey = opts['parentKey'] or ""
    local attempts = opts['attempts']
    local attemptsMade = opts['attemptsMade']
    local maxMetricsSize = opts['maxMetricsSize']
    local maxCount = opts['keepJobs']['count']
    local maxAge = opts['keepJobs']['age']

    if token ~= "0" then
        local lockKey = jobIdKey .. ':lock'
        if rcall("GET", lockKey) == token then
            rcall("DEL", lockKey)
            rcall("SREM", KEYS[5], ARGV[1])
        else
            return -2
        end
    end

    if rcall("SCARD", jobIdKey .. ":dependencies") ~= 0 then -- // Make sure it does not have pending dependencies
        return -4
    end

    local jobId = ARGV[1]
    local timestamp = ARGV[2]

    -- Remove from active list (if not active we shall return error)
    local numRemovedElements = rcall("LREM", KEYS[2], -1, jobId)

    if (numRemovedElements < 1) then return -3 end

    -- Trim events before emiting them to avoid trimming events emitted in this script
    trimEvents(KEYS[11], KEYS[4])

    -- If job has a parent we need to
    -- 1) remove this job id from parents dependencies
    -- 2) move the job Id to parent "processed" set
    -- 3) push the results into parent "results" list
    -- 4) if parent's dependencies is empty, then move parent to "wait/paused". Note it may be a different queue!.
    if parentId == "" and parentKey ~= "" then
        parentId = getJobIdFromKey(parentKey)
        parentQueueKey = getJobKeyPrefix(parentKey, ":" .. parentId)
    end
    if parentId ~= "" and ARGV[5] == "completed" then
        local parentKey = parentQueueKey .. ":" .. parentId
        local dependenciesSet = parentKey .. ":dependencies"
        local result = rcall("SREM", dependenciesSet, jobIdKey)
        if result == 1 then
            updateParentDepsIfNeeded(parentKey, parentQueueKey, dependenciesSet,
                                     parentId, jobIdKey, ARGV[4])
        end
    end

    -- Remove job?
    if maxCount ~= 0 then
        local targetSet = KEYS[9]
        -- Add to complete/failed set
        rcall("ZADD", targetSet, timestamp, jobId)
        rcall("HMSET", jobIdKey, ARGV[3], ARGV[4], "finishedOn", timestamp) -- "returnvalue" / "failedReason" and "finishedOn"

        -- Remove old jobs?
        local prefix = ARGV[8]

        if maxAge ~= nil then
            removeJobsByMaxAge(timestamp, maxAge, targetSet, prefix)
        end

        if maxCount ~= nil and maxCount > 0 then
            removeJobsByMaxCount(maxCount, targetSet, prefix)
        end
    else
        rcall("DEL", jobIdKey, jobIdKey .. ':logs', jobIdKey .. ':processed')
    end

    rcall("XADD", KEYS[4], "*", "event", ARGV[5], "jobId", jobId, ARGV[3],
          ARGV[4])

    if ARGV[5] == "failed" then
        if tonumber(attemptsMade) >= tonumber(attempts) then
            rcall("XADD", KEYS[4], "*", "event", "retries-exhausted", "jobId",
                  jobId, "attemptsMade", attemptsMade)
        end
    end

    -- Collect metrics
    if maxMetricsSize ~= "" then
        collectMetrics(KEYS[12], KEYS[12]..':data', maxMetricsSize, timestamp)
    end

    -- Try to get next job to avoid an extra roundtrip if the queue is not closing,
    -- and not rate limited.
    if (ARGV[7] == "1") then
        -- move from wait to active
        local jobId = rcall("RPOPLPUSH", KEYS[1], KEYS[2])
        if jobId then
            return moveJobFromWaitToActive(KEYS, ARGV[8], jobId, timestamp, opts)
        end
    end

    local waitLen = rcall("LLEN", KEYS[1])
    if waitLen == 0 then
        local activeLen = rcall("LLEN", KEYS[2])

        if activeLen == 0 then
            rcall("XADD", KEYS[4], "*", "event", "drained")
        end
    end  

    return 0
else
    return -1
end
