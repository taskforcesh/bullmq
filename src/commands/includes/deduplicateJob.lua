--[[
  Function to debounce a job.
]]
-- Includes
--- @include "deduplicateJobWithoutReplace"
--- @include "removeJobKeys"
--- @include "setDeduplicationKey"
--- @include "storeDeduplicatedNextJob"

local function removeDelayedJob(delayedKey, deduplicationKey, eventsKey, maxEvents, currentDeduplicatedJobId,
    jobId, deduplicationId, prefix)
    if rcall("ZREM", delayedKey, currentDeduplicatedJobId) > 0 then
        removeJobKeys(prefix .. currentDeduplicatedJobId)
        rcall("XADD", eventsKey, "*", "event", "removed", "jobId", currentDeduplicatedJobId,
            "prev", "delayed")

        -- TODO remove debounced event in next breaking change
        rcall("XADD", eventsKey, "MAXLEN", "~", maxEvents, "*", "event", "debounced", "jobId",
            jobId, "debounceId", deduplicationId)
        rcall("XADD", eventsKey, "MAXLEN", "~", maxEvents, "*", "event", "deduplicated", "jobId",
            jobId, "deduplicationId", deduplicationId, "deduplicatedJobId", currentDeduplicatedJobId)

        return true
    end

    return false
end

local function deduplicateJob(deduplicationOpts, jobId, delayedKey, deduplicationKey, eventsKey, maxEvents,
    prefix, jobName, jobData, fullOpts, parentKey, parentData, parentDependenciesKey, repeatJobKey)
    local deduplicationId = deduplicationOpts and deduplicationOpts['id']
    if deduplicationId then
        if deduplicationOpts['replace'] then
            local currentDebounceJobId = rcall('GET', deduplicationKey)
            if currentDebounceJobId then
                local isRemoved = removeDelayedJob(delayedKey, deduplicationKey, eventsKey, maxEvents,
                    currentDebounceJobId, jobId, deduplicationId, prefix)
                if isRemoved then
                    if deduplicationOpts['keepLastIfActive'] then
                        rcall('SET', deduplicationKey, jobId)
                    else
                        local ttl = deduplicationOpts['ttl']
                        if not deduplicationOpts['extend'] and ttl and ttl > 0 then
                            rcall('SET', deduplicationKey, jobId, 'KEEPTTL')
                        else
                            setDeduplicationKey(deduplicationKey, jobId, deduplicationOpts)
                        end
                    end
                    return
                else
                    storeDeduplicatedNextJob(deduplicationOpts, currentDebounceJobId, prefix,
                        deduplicationId, jobName, jobData, fullOpts, eventsKey, maxEvents, jobId,
                        parentKey, parentData, parentDependenciesKey, repeatJobKey)
                    return currentDebounceJobId
                end
            else
                if deduplicationOpts['keepLastIfActive'] then
                    rcall('SET', deduplicationKey, jobId)
                else
                    setDeduplicationKey(deduplicationKey, jobId, deduplicationOpts)
                end
                return
            end
        else
            return deduplicateJobWithoutReplace(deduplicationId, deduplicationOpts,
                jobId, deduplicationKey, eventsKey, maxEvents, prefix, jobName, jobData, fullOpts,
                parentKey, parentData, parentDependenciesKey, repeatJobKey)
        end
    end
end
