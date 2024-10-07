--[[
  Function to clean job set.
  Returns jobIds and deleted count number.
]] 

-- Includes
--- @include "batches"
--- @include "getJobsInZset"
--- @include "getTimestamp"
--- @include "removeJob"
local function isJobSchedulerJob(jobId, jobSchedulersKey)
    if jobSchedulersKey then
        local jobSchedulerId = jobId:match("repeat:(.*):%d+")
        if jobSchedulerId then
            return rcall("ZSCORE", jobSchedulersKey, jobSchedulerId)
        end
    end
    return false
end

local function cleanSet(
    setKey,
    jobKeyPrefix,
    rangeEnd,
    timestamp,
    limit,
    attributes,
    isFinished,
    jobSchedulersKey)
    local jobs = getJobsInZset(setKey, rangeEnd, limit)
    local deleted = {}
    local deletedCount = 0
    local jobTS
    for i, job in ipairs(jobs) do
        if limit > 0 and deletedCount >= limit then
            break
        end

        -- Extract a Job Scheduler Id from jobId ("repeat:job-scheduler-id:millis") 
        -- and check if it is in the scheduled jobs
        if not isJobSchedulerJob(job, jobSchedulersKey) then
            local jobKey = jobKeyPrefix .. job
            if isFinished then
                removeJob(job, true, jobKeyPrefix, true --[[remove debounce key]] )
                deletedCount = deletedCount + 1
                table.insert(deleted, job)
            else
                -- * finishedOn says when the job was completed, but it isn't set unless the job has actually completed
                jobTS = getTimestamp(jobKey, attributes)
                if (not jobTS or jobTS <= timestamp) then
                    removeJob(job, true, jobKeyPrefix, true --[[remove debounce key]] )
                    deletedCount = deletedCount + 1
                    table.insert(deleted, job)
                end
            end
        end
    end

    if (#deleted > 0) then
        for from, to in batches(#deleted, 7000) do
            rcall("ZREM", setKey, unpack(deleted, from, to))
        end
    end

    return {deleted, deletedCount}
end
