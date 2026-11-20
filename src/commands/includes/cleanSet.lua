--[[
  Function to clean job set.
  Returns jobIds and deleted count number.
]] 

-- Includes
--- @include "batches"
--- @include "getJobsInZset"
--- @include "getTimestamp"
--- @include "isJobSchedulerJob"
--- @include "removeJob"

local function cleanSet(
    setKey,
    jobKeyPrefix,
    rangeEnd,
    timestamp,
    limit,
    attributes,
    isFinished,
    jobSchedulersKey,
    jobName)
    local deleted = {}
    local deletedCount = 0
    local batchSize = 1000
    local offset = 0
    local jobTS

    while true do
        local jobs
        if jobName == nil then
            jobs = getJobsInZset(setKey, rangeEnd, limit)
        else
            jobs = rcall("ZRANGEBYSCORE", setKey, 0, rangeEnd, "LIMIT", offset, batchSize)
        end

        if #jobs == 0 then
            break
        end

        for _, job in ipairs(jobs) do
            if limit > 0 and deletedCount >= limit then
                break
            end

            local jobKey = jobKeyPrefix .. job
            -- Extract a Job Scheduler Id from jobId ("repeat:job-scheduler-id:millis")
            -- and check if it is in the scheduled jobs
            if (jobName == nil or rcall("HGET", jobKey, "name") == jobName) and
                not (jobSchedulersKey and isJobSchedulerJob(job, jobKey, jobSchedulersKey)) then
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

        if jobName == nil or (limit > 0 and deletedCount >= limit) or #jobs < batchSize then
            break
        end

        offset = offset + #jobs
    end

    if (#deleted > 0) then
        for from, to in batches(#deleted, 7000) do
            rcall("ZREM", setKey, unpack(deleted, from, to))
        end
    end

    return {deleted, deletedCount}
end
