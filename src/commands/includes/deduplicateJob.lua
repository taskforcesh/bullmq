--[[
  Function to debounce a job.
]]
-- Includes
--- @include "removeJobKeys"
local function deduplicateJob(deduplicationOpts, jobId, delayedKey, deduplicationKey, eventsKey, maxEvents,
    prefix)
    local deduplicationId = deduplicationOpts and deduplicationOpts['id']
    if deduplicationId then
        local ttl = deduplicationOpts['ttl']
        if deduplicationOpts['replace'] and ttl and ttl > 0 then
            local currentDebounceJobId = rcall('GET', deduplicationKey)
            if currentDebounceJobId then
                if rcall("ZREM", delayedKey, currentDebounceJobId) > 0 then
                    removeJobKeys(prefix .. currentDebounceJobId)
                    rcall("XADD", eventsKey, "*", "event", "removed", "jobId", currentDebounceJobId,
                        "prev", "delayed")

                    if deduplicationOpts['extend'] then
                        rcall('SET', deduplicationKey, jobId, 'PX', ttl)
                    else
                        rcall('SET', deduplicationKey, jobId, 'KEEPTTL')
                    end

                    rcall("XADD", eventsKey, "MAXLEN", "~", maxEvents, "*", "event", "deduplicated", "jobId",
                        jobId, "deduplicationId", deduplicationId, "deduplicatedJobId", currentDebounceJobId)
                    return
                else
                    return currentDebounceJobId
                end
            else
                rcall('SET', deduplicationKey, jobId, 'PX', ttl)
                return
            end
        else
            local ttl = deduplicationOpts['ttl']
            local deduplicationKeyExists
            if ttl then
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
                rcall("XADD", eventsKey, "MAXLEN", "~", maxEvents, "*", "event", "debounced", "jobId",
                    currentDebounceJobId, "debounceId", deduplicationId)
                rcall("XADD", eventsKey, "MAXLEN", "~", maxEvents, "*", "event", "deduplicated", "jobId",
                    currentDebounceJobId, "deduplicationId", deduplicationId, "deduplicatedJobId", jobId)
                return currentDebounceJobId
            end
        end
    end
end
