--[[
  Updates the delay set, by moving delayed jobs that should
  be processed now to "wait".

     Events:
      'waiting'
]]

-- Includes
--- @include "addJobWithPriority"

-- Try to get as much as 1000 jobs at once
local function promoteDelayedJobs(delayedKey, targetKey, priorityKey,
                                  eventStreamKey, prefix, timestamp)
    local jobs = rcall("ZRANGEBYSCORE", delayedKey, 0, (timestamp + 1) * 0x1000, "LIMIT", 0, 1000)

    if (#jobs > 0) then
        rcall("ZREM", delayedKey, unpack(jobs))

        for _, jobId in ipairs(jobs) do
            local priority =
                tonumber(rcall("HGET", prefix .. jobId, "priority")) or 0

            if priority == 0 then
                -- LIFO or FIFO
                rcall("LPUSH", targetKey, jobId)
            else
                addJobWithPriority(priorityKey, priority, targetKey, jobId)
            end

            -- Emit waiting event
            rcall("XADD", eventStreamKey, "*", "event", "waiting", "jobId",
                  jobId, "prev", "delayed")
            rcall("HSET", prefix .. jobId, "delay", 0)
        end
    end
end
