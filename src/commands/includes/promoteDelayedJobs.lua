--[[
  Updates the delay set, by moving delayed jobs that should
  be processed now to "wait".

     Events:
      'waiting'
]]
local rcall = redis.call

-- Includes
--- @include "getTargetQueueList"

-- Try to get as much as 1000 jobs at once, and returns the nextTimestamp if
-- there are more delayed jobs to process.
local function promoteDelayedJobs(delayedKey, waitKey, priorityKey, pausedKey,
                                  metaKey, eventStreamKey, prefix, timestamp)
    local jobs = rcall("ZRANGEBYSCORE", delayedKey, 0, (timestamp + 1) * 0x1000, "LIMIT", 0, 1000)

    if (#jobs > 0) then
        rcall("ZREM", delayedKey, unpack(jobs))

        -- check if we need to use push in paused instead of waiting
        local target = getTargetQueueList(metaKey, waitKey, pausedKey)

        for _, jobId in ipairs(jobs) do
            local priority =
                tonumber(rcall("HGET", prefix .. jobId, "priority")) or 0

            if priority == 0 then
                -- LIFO or FIFO
                rcall("LPUSH", target, jobId)
            else
                -- Priority add
                rcall("ZADD", priorityKey, priority, jobId)
                local count = rcall("ZCOUNT", priorityKey, 0, priority)

                local len = rcall("LLEN", target)
                local id = rcall("LINDEX", target, len - (count - 1))
                if id then
                    rcall("LINSERT", target, "BEFORE", id, jobId)
                else
                    rcall("RPUSH", target, jobId)
                end
            end

            -- Emit waiting event
            rcall("XADD", eventStreamKey, "*", "event", "waiting", "jobId",
                  jobId, "prev", "delayed")
        end
    end

    local nextTimestamp = rcall("ZRANGE", delayedKey, 0, 0, "WITHSCORES")[2]
    if (nextTimestamp ~= nil) then
        nextTimestamp = nextTimestamp / 0x1000
    end
    return nextTimestamp
end
