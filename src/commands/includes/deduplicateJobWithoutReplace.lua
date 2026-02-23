--[[
  Function to deduplicate a job.
]]

local function deduplicateJobWithoutReplace(deduplicationId, deduplicationOpts, jobId, deduplicationKey,
    eventsKey, maxEvents)
    local ttl = deduplicationOpts['ttl']
    local deduplicationKeyExists
    if ttl and ttl > 0 then
        if deduplicationOpts['extend'] then
            local currentDebounceJobId = rcall('GET', deduplicationKey)
            if currentDebounceJobId then
                rcall('SET', deduplicationKey, currentDebounceJobId, 'PX', ttl)
                rcall("XADD", eventsKey, "MAXLEN", "~", maxEvents, "*", "event", "debounced",
                    "jobId", currentDebounceJobId, "debounceId", deduplicationId)
                rcall("XADD", eventsKey, "MAXLEN", "~", maxEvents, "*", "event", "deduplicated", "jobId",
                    currentDebounceJobId, "deduplicationId", deduplicationId, "deduplicatedJobId", jobId)
                return currentDebounceJobId
            else
                rcall('SET', deduplicationKey, jobId, 'PX', ttl)
                return
            end
        else
            deduplicationKeyExists = not rcall('SET', deduplicationKey, jobId, 'PX', ttl, 'NX')
        end
    else
        deduplicationKeyExists = not rcall('SET', deduplicationKey, jobId, 'NX')
    end

    if deduplicationKeyExists then
        local currentDebounceJobId = rcall('GET', deduplicationKey)
        -- TODO remove debounced event in next breaking change
        rcall("XADD", eventsKey, "MAXLEN", "~", maxEvents, "*", "event", "debounced", "jobId",
            currentDebounceJobId, "debounceId", deduplicationId)
        rcall("XADD", eventsKey, "MAXLEN", "~", maxEvents, "*", "event", "deduplicated", "jobId",
            currentDebounceJobId, "deduplicationId", deduplicationId, "deduplicatedJobId", jobId)
        return currentDebounceJobId
    end
end
