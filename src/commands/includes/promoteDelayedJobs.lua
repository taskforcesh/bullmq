--[[
  Updates the delay set, by moving delayed jobs that should
  be processed now to "wait".

     Events:
      'waiting'
]]

-- Includes
--- @include "addBaseMarkerIfNeeded"
--- @include "addJobInTargetList"
--- @include "addJobWithPriority"
--- @include "getPriorityScore"

-- Try to get as much as 1000 jobs at once
local function promoteDelayedJobs(delayedKey, markerKey, targetKey, prioritizedKey,
                                  eventStreamKey, prefix, timestamp, priorityCounterKey, isPaused)
    local jobs = rcall("ZRANGEBYSCORE", delayedKey, 0, (timestamp + 1) * 0x1000 - 1, "LIMIT", 0, 1000)

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
                local score = getPriorityScore(priority, priorityCounterKey)
                rcall("ZADD", prioritizedKey, score, jobId)
            end

            -- Emit waiting event
            rcall("XADD", eventStreamKey, "*", "event", "waiting", "jobId",
                  jobId, "prev", "delayed")
            rcall("HSET", jobKey, "delay", 0)
        end

        addBaseMarkerIfNeeded(markerKey, isPaused)
    end
end
