--[[
  Drains the queue, removes all jobs that are waiting
  or delayed, but not active, completed or failed

  Input:
    KEYS[1] 'wait',
    KEYS[2] 'paused'
    KEYS[3] 'delayed'
    KEYS[4] 'prioritized'
    KEYS[5] 'jobschedulers' (repeat)

    ARGV[1]  queue key prefix
]]
local rcall = redis.call
local queueBaseKey = ARGV[1]

--- @include "includes/removeListJobs"
--- @include "includes/removeZSetJobs"

removeListJobs(KEYS[1], true, queueBaseKey, 0) -- wait
removeListJobs(KEYS[2], true, queueBaseKey, 0) -- paused

if KEYS[3] ~= "" then

    -- We must not remove delayed jobs if they are associated to a job scheduler.
    local scheduledJobs = {}
    local jobSchedulers = rcall("ZRANGE", KEYS[5], 0, -1, "WITHSCORES")

    -- For every job scheduler, get the current delayed job id.
    for i = 1, #jobSchedulers, 2 do
        local jobSchedulerId = jobSchedulers[i]
        local jobSchedulerMillis = jobSchedulers[i + 1]

        local delayedJobId = "repeat:" .. jobSchedulerId .. ":" .. jobSchedulerMillis
        scheduledJobs[delayedJobId] = true
    end

    removeZSetJobs(KEYS[3], true, queueBaseKey, 0, scheduledJobs) -- delayed
end

removeZSetJobs(KEYS[4], true, queueBaseKey, 0) -- prioritized
