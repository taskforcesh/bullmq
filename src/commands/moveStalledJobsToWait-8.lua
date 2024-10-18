--[[
  Move stalled jobs to wait.

    Input:
      KEYS[1] 'stalled' (SET)
      KEYS[2] 'wait',   (LIST)
      KEYS[3] 'active', (LIST)
      KEYS[4] 'failed', (ZSET)
      KEYS[5] 'stalled-check', (KEY)
      KEYS[6] 'meta', (KEY)
      KEYS[7] 'marker'
      KEYS[8] 'event stream' (STREAM)

      ARGV[1]  Max stalled job count
      ARGV[2]  queue.toKey('')
      ARGV[3]  timestamp
      ARGV[4]  max check time

    Events:
      'stalled' with stalled job id.
]]

local rcall = redis.call

-- Includes
--- @include "includes/addJobInTargetList"
--- @include "includes/batches"
--- @include "includes/isQueuePausedOrMaxed"
--- @include "includes/moveParentIfNeeded"
--- @include "includes/removeDebounceKeyIfNeeded"
--- @include "includes/removeJob"
--- @include "includes/removeJobsByMaxAge"
--- @include "includes/removeJobsByMaxCount"
--- @include "includes/trimEvents"

local stalledKey = KEYS[1]
local waitKey = KEYS[2]
local activeKey = KEYS[3]
local failedKey = KEYS[4]
local stalledCheckKey = KEYS[5]
local metaKey = KEYS[6]
local markerKey = KEYS[7]
local eventStreamKey = KEYS[8]
local maxStalledJobCount = tonumber(ARGV[1])
local queueKeyPrefix = ARGV[2]
local timestamp = ARGV[3]
local maxCheckTime = ARGV[4]

if rcall("EXISTS", stalledCheckKey) == 1 then return {{}, {}} end

rcall("SET", stalledCheckKey, timestamp, "PX", maxCheckTime)

-- Trim events before emiting them to avoid trimming events emitted in this script
trimEvents(metaKey, eventStreamKey)

-- Move all stalled jobs to wait
local stalling = rcall('SMEMBERS', stalledKey)
local stalled = {}
local failed = {}
if (#stalling > 0) then
    rcall('DEL', stalledKey)

    -- Remove from active list
    for i, jobId in ipairs(stalling) do
        local jobKey = queueKeyPrefix .. jobId

        -- Check that the lock is also missing, then we can handle this job as really stalled.
        if (rcall("EXISTS", jobKey .. ":lock") == 0) then
            --  Remove from the active queue.
            local removed = rcall("LREM", activeKey, 1, jobId)

            if (removed > 0) then
                -- If this job has been stalled too many times, such as if it crashes the worker, then fail it.
                local stalledCount =
                    rcall("HINCRBY", jobKey, "stalledCounter", 1)
                if (stalledCount > maxStalledJobCount) then
                    local jobAttributes = rcall("HMGET", jobKey, "opts", "parent", "deid")
                    local rawOpts = jobAttributes[1]
                    local rawParentData = jobAttributes[2]
                    local opts = cjson.decode(rawOpts)
                    local removeOnFailType = type(opts["removeOnFail"])
                    rcall("ZADD", failedKey, timestamp, jobId)
                    removeDebounceKeyIfNeeded(queueKeyPrefix, jobAttributes[3])

                    local failedReason =
                        "job stalled more than allowable limit"
                    rcall("HMSET", jobKey, "failedReason", failedReason,
                            "finishedOn", timestamp)
                    rcall("XADD", eventStreamKey, "*", "event",
                            "failed", "jobId", jobId, 'prev', 'active',
                            'failedReason', failedReason)

                    if rawParentData ~= false then
                        local parentData = cjson.decode(rawParentData)
                        moveParentIfNeeded(parentData, parentData['queueKey'] .. ':' .. parentData['id'], jobKey,
                            failedReason, timestamp)
                    end

                    if removeOnFailType == "number" then
                        removeJobsByMaxCount(opts["removeOnFail"],
                                                failedKey, queueKeyPrefix)
                    elseif removeOnFailType == "boolean" then
                        if opts["removeOnFail"] then
                            removeJob(jobId, false, queueKeyPrefix,
                                false --[[remove debounce key]])
                            rcall("ZREM", failedKey, jobId)
                        end
                    elseif removeOnFailType ~= "nil" then
                        local maxAge = opts["removeOnFail"]["age"]
                        local maxCount = opts["removeOnFail"]["count"]

                        if maxAge ~= nil then
                            removeJobsByMaxAge(timestamp, maxAge,
                                                failedKey, queueKeyPrefix)
                        end

                        if maxCount ~= nil and maxCount > 0 then
                            removeJobsByMaxCount(maxCount, failedKey,
                                                    queueKeyPrefix)
                        end
                    end

                    table.insert(failed, jobId)
                else
                    local isPausedOrMaxed = isQueuePausedOrMaxed(metaKey, activeKey)

                    -- Move the job back to the wait queue, to immediately be picked up by a waiting worker.
                    addJobInTargetList(waitKey, markerKey, "RPUSH", isPausedOrMaxed, jobId)

                    rcall("XADD", eventStreamKey, "*", "event",
                            "waiting", "jobId", jobId, 'prev', 'active')

                    -- Emit the stalled event
                    rcall("XADD", eventStreamKey, "*", "event",
                            "stalled", "jobId", jobId)
                    table.insert(stalled, jobId)
                end
            end
        end
    end
end

-- Mark potentially stalled jobs
local active = rcall('LRANGE', activeKey, 0, -1)

if (#active > 0) then
    for from, to in batches(#active, 7000) do
        rcall('SADD', stalledKey, unpack(active, from, to))
    end
end

return {failed, stalled}