--[[
  Updates the delay set, by moving delayed jobs that should
  be processed now to "wait".

     Events:
      'waiting'
]]

-- Includes
--- @include "addJobInTargetList"
--- @include "addJobWithPriority"

-- Try to get as much as 1000 jobs at once
local function promoteDelayedJobs(delayedKey, markerKey, targetKey, prioritizedKey,
                                  eventStreamKey, prefix, timestamp, priorityCounterKey, isPaused, pendingKey)
    local jobs = rcall("ZRANGEBYSCORE", delayedKey, 0, (timestamp + 1) * 0x1000 - 1, "LIMIT", 0, 1000)

    if (#jobs > 0) then
        rcall("ZREM", delayedKey, unpack(jobs))

        for _, jobId in ipairs(jobs) do
            local jobKey = prefix .. jobId
            local jobAttributes = rcall("HMGET", jobKey, "priority", "pen")
            local priority =
                tonumber(jobAttributes[1]) or 0

            if jobAttributes[2] then
                rcall("ZREM", pendingKey, jobId)
                addJobInTargetList(targetKey, markerKey, "RPUSH", isPaused, jobId)
            else
                if priority == 0 then
                    -- LIFO or FIFO
                    addJobInTargetList(targetKey, markerKey, "LPUSH", isPaused, jobId)
                else
                    addJobWithPriority(markerKey, prioritizedKey, priority,
                      jobId, priorityCounterKey, isPaused)
                end    
            end

            -- Emit waiting event
            rcall("XADD", eventStreamKey, "*", "event", "waiting", "jobId",
                  jobId, "prev", "delayed")
            rcall("HSET", jobKey, "delay", 0)
        end
    end
end
