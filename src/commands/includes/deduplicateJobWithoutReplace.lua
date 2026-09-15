--[[
  Function to deduplicate a job.
]]
--- @include "setDeduplicationKey"
--- @include "storeDeduplicatedNextJob"

local function deduplicateJobWithoutReplace(deduplicationId, deduplicationOpts, jobId, deduplicationKey,
    eventsKey, maxEvents, prefix, jobName, jobData, fullOpts,
    parentKey, parentData, parentDependenciesKey, repeatJobKey)
    local ttl = deduplicationOpts['ttl']
    local deduplicationKeyExists
    if ttl and ttl > 0 then
        if deduplicationOpts['extend'] then
            local currentDeduplicatedJobId = rcall('GET', deduplicationKey)
            if currentDeduplicatedJobId then
                if storeDeduplicatedNextJob(deduplicationOpts, currentDeduplicatedJobId, prefix,
                    deduplicationId, jobName, jobData, fullOpts, eventsKey, maxEvents, jobId,
                    parentKey, parentData, parentDependenciesKey, repeatJobKey) then
                    return currentDeduplicatedJobId
                end
                if deduplicationOpts['keepLastIfActive'] then
                    rcall('SET', deduplicationKey, currentDeduplicatedJobId)
                else
                    setDeduplicationKey(deduplicationKey, currentDeduplicatedJobId, deduplicationOpts)
                end
                rcall("XADD", eventsKey, "MAXLEN", "~", maxEvents, "*", "event", "deduplicated", "jobId",
                    currentDeduplicatedJobId, "deduplicationId", deduplicationId, "deduplicatedJobId", jobId)
                return currentDeduplicatedJobId
            else
                if deduplicationOpts['keepLastIfActive'] then
                    rcall('SET', deduplicationKey, jobId)
                else
                    setDeduplicationKey(deduplicationKey, jobId, deduplicationOpts)
                end
                return
            end
        else
            if deduplicationOpts['keepLastIfActive'] then
                deduplicationKeyExists = not rcall('SET', deduplicationKey, jobId, 'NX')
            else
                deduplicationKeyExists = not rcall('SET', deduplicationKey, jobId, 'PX', ttl, 'NX')
            end
        end
    else
        deduplicationKeyExists = not rcall('SET', deduplicationKey, jobId, 'NX')
    end

    if deduplicationKeyExists then
        local currentDeduplicatedJobId = rcall('GET', deduplicationKey)

        -- In simple mode (no ttl), the deduplication key lives until the job is
        -- completed or failed. If that job no longer exists because of an outage, the key is stale,
        -- so we remove it and start a new deduplication window with this job.
        if not (ttl and ttl > 0) and rcall('EXISTS', prefix .. currentDeduplicatedJobId) == 0 then
            rcall('DEL', deduplicationKey)
            rcall('SET', deduplicationKey, jobId)
            return
        end

        if storeDeduplicatedNextJob(deduplicationOpts, currentDeduplicatedJobId, prefix,
            deduplicationId, jobName, jobData, fullOpts, eventsKey, maxEvents, jobId,
            parentKey, parentData, parentDependenciesKey, repeatJobKey) then
            return currentDeduplicatedJobId
        end

        rcall("XADD", eventsKey, "MAXLEN", "~", maxEvents, "*", "event", "deduplicated", "jobId",
            currentDeduplicatedJobId, "deduplicationId", deduplicationId, "deduplicatedJobId", jobId)
        return currentDeduplicatedJobId
    end
end
