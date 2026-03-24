--[[
  Function to deduplicate a job.
]]

local function deduplicateJobWithoutReplace(deduplicationId, deduplicationOpts, jobId, deduplicationKey,
    eventsKey, maxEvents, prefix, jobName, jobData, fullOpts)
    local ttl = deduplicationOpts['ttl']
    local requeueIfActive = deduplicationOpts['requeueIfActive']
    local deduplicationKeyExists
    if ttl and ttl > 0 then
        if deduplicationOpts['extend'] then
            local currentDebounceJobId = rcall('GET', deduplicationKey)
            if currentDebounceJobId then
                -- Check if existing job is active and requeueIfActive is set
                if requeueIfActive and prefix then
                    local activeKey = prefix .. "active"
                    if rcall('LPOS', activeKey, currentDebounceJobId) ~= false then
                        -- Existing job is active, store requeue data (latest wins)
                        local deduplicationNextKey = prefix .. "dn:" .. deduplicationId
                        rcall('HSET', deduplicationNextKey, 'name', jobName, 'data', jobData, 'opts', cjson.encode(fullOpts))
                        rcall("XADD", eventsKey, "MAXLEN", "~", maxEvents, "*", "event", "deduplicated", "jobId",
                            currentDebounceJobId, "deduplicationId", deduplicationId, "deduplicatedJobId", jobId)
                        return currentDebounceJobId
                    end
                end
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

        -- Check if existing job is active and requeueIfActive is set
        if requeueIfActive and prefix and currentDebounceJobId then
            local activeKey = prefix .. "active"
            if rcall('LPOS', activeKey, currentDebounceJobId) ~= false then
                -- Existing job is active, store requeue data (latest wins)
                local deduplicationNextKey = prefix .. "dn:" .. deduplicationId
                rcall('HSET', deduplicationNextKey, 'name', jobName, 'data', jobData, 'opts', cjson.encode(fullOpts))
                rcall("XADD", eventsKey, "MAXLEN", "~", maxEvents, "*", "event", "deduplicated", "jobId",
                    currentDebounceJobId, "deduplicationId", deduplicationId, "deduplicatedJobId", jobId)
                return currentDebounceJobId
            end
        end

        -- TODO remove debounced event in next breaking change
        rcall("XADD", eventsKey, "MAXLEN", "~", maxEvents, "*", "event", "debounced", "jobId",
            currentDebounceJobId, "debounceId", deduplicationId)
        rcall("XADD", eventsKey, "MAXLEN", "~", maxEvents, "*", "event", "deduplicated", "jobId",
            currentDebounceJobId, "deduplicationId", deduplicationId, "deduplicatedJobId", jobId)
        return currentDebounceJobId
    end
end
