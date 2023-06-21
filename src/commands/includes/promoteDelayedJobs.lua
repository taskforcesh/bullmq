--[[
  Updates the delay set, by moving delayed jobs that should
  be processed now to "wait".

     Events:
      'waiting'
]]

-- Includes
--- @include "addJobWithPriority"

-- Try to get as much as 1000 jobs at once
local function promoteDelayedJobs(delayedKey, waitKey, targetKey, prioritizedKey,
                                  eventStreamKey, prefix, timestamp, paused, priorityCounterKey)
    local jobs = rcall("ZRANGEBYSCORE", delayedKey, 0, (timestamp + 1) * 0x1000, "LIMIT", 0, 1000)

    if (#jobs > 0) then
        rcall("ZREM", delayedKey, unpack(jobs))

        for _, jobId in ipairs(jobs) do
            local jobKey = prefix .. jobId
            local priority =
                tonumber(rcall("HGET", jobKey, "priority")) or 0

            if priority == 0 then
                -- LIFO or FIFO
                rcall("LPUSH", targetKey, jobId)
            else
                addJobWithPriority(waitKey, prioritizedKey, priority, paused,
                  jobId, priorityCounterKey)
            end

            -- Emit waiting event
            rcall("XADD", eventStreamKey, "*", "event", "waiting", "jobId",
                  jobId, "prev", "delayed")
            rcall("HSET", jobKey, "delay", 0)
        end
    end
end
