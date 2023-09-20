--[[
  Move stalled jobs to wait.

    Input:
      stalledKey 'stalled' (SET)
      waitKey 'wait',   (LIST)
      activeKey 'active', (LIST)
      failedKey 'failed', (ZSET)
      stalledCheckKey 'stalled-check', (KEY)
      metaKey 'meta', (KEY)
      pausedKey 'paused', (LIST)
      eventStreamKey 'event stream' (STREAM)

      maxStalledJobCount  Max stalled job count
      queueKeyPrefix  queue.toKey('')
      timestamp  timestamp
      maxCheckTime  max check time

    Events:
      'stalled' with stalled job id.
]]
local rcall = redis.call

-- Includes
--- @include "batches"
--- @include "getTargetQueueList"
--- @include "removeJob"
--- @include "removeJobsByMaxAge"
--- @include "removeJobsByMaxCount"
--- @include "trimEvents"

-- Check if we need to check for stalled jobs now.

local function checkStalledJobs(stalledKey, waitKey, activeKey, failedKey,
                                stalledCheckKey, metaKey, pausedKey,
                                eventStreamKey, maxStalledJobCount,
                                queueKeyPrefix, timestamp, maxCheckTime)
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

        local MAX_STALLED_JOB_COUNT = tonumber(maxStalledJobCount)

        -- Remove from active list
        for i, jobId in ipairs(stalling) do

            if string.sub(jobId, 1, 2) == "0:" then
                -- If the jobId is a delay marker ID we just remove it.
                rcall("LREM", activeKey, 1, jobId)
            else
                local jobKey = queueKeyPrefix .. jobId

                -- Check that the lock is also missing, then we can handle this job as really stalled.
                if (rcall("EXISTS", jobKey .. ":lock") == 0) then
                    --  Remove from the active queue.
                    local removed = rcall("LREM", activeKey, 1, jobId)

                    if (removed > 0) then
                        -- If this job has been stalled too many times, such as if it crashes the worker, then fail it.
                        local stalledCount =
                            rcall("HINCRBY", jobKey, "stalledCounter", 1)
                        if (stalledCount > MAX_STALLED_JOB_COUNT) then
                            local rawOpts = rcall("HGET", jobKey, "opts")
                            local opts = cjson.decode(rawOpts)
                            local removeOnFailType = type(opts["removeOnFail"])
                            rcall("ZADD", failedKey, timestamp, jobId)
                            local failedReason =
                                "job stalled more than allowable limit"
                            rcall("HMSET", jobKey, "failedReason", failedReason,
                                  "finishedOn", timestamp)
                            rcall("XADD", eventStreamKey, "*", "event",
                                  "failed", "jobId", jobId, 'prev', 'active',
                                  'failedReason', failedReason)

                            if removeOnFailType == "number" then
                                removeJobsByMaxCount(opts["removeOnFail"],
                                                     failedKey, queueKeyPrefix)
                            elseif removeOnFailType == "boolean" then
                                if opts["removeOnFail"] then
                                    removeJob(jobId, false, queueKeyPrefix)
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
                            local target =
                                getTargetQueueList(metaKey, waitKey, pausedKey)

                            -- Move the job back to the wait queue, to immediately be picked up by a waiting worker.
                            rcall("RPUSH", target, jobId)
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
    end

    -- Mark potentially stalled jobs
    local active = rcall('LRANGE', activeKey, 0, -1)

    if (#active > 0) then
        for from, to in batches(#active, 7000) do
            rcall('SADD', stalledKey, unpack(active, from, to))
        end
    end

    return {failed, stalled}
end
