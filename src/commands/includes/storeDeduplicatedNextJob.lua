--[[
  Function to store a deduplicated next job if the existing job is not
  finished and keepLastIfActive is set. When the active job finishes, the stored
  proto-job is used to create a real job in the queue.
  Returns true if the proto-job was stored, false otherwise.

  Note: this helper assumes only that the job exists and is not completed/failed
  (i.e. the finishedOn attribute does not exist).
]]

local function storeDeduplicatedNextJob(deduplicationOpts, currentDebounceJobId, prefix,
    deduplicationId, jobName, jobData, fullOpts, eventsKey, maxEvents, jobId,
    parentKey, parentData, parentDependenciesKey, repeatJobKey)
    if deduplicationOpts['keepLastIfActive'] and currentDebounceJobId then
        local jobKey = prefix .. currentDebounceJobId
        if rcall('EXISTS', jobKey) == 1
            and rcall('HEXISTS', jobKey, 'finishedOn') == 0 then
            local deduplicationNextKey = prefix .. "dn:" .. deduplicationId
            local fields = {'name', jobName, 'data', jobData, 'opts', cjson.encode(fullOpts)}

            if parentKey then
                fields[#fields+1] = 'pk'
                fields[#fields+1] = parentKey
            end

            if parentData then
                fields[#fields+1] = 'pd'
                fields[#fields+1] = parentData
            end

            if parentDependenciesKey then
                fields[#fields+1] = 'pdk'
                fields[#fields+1] = parentDependenciesKey
            end

            if repeatJobKey then
                fields[#fields+1] = 'rjk'
                fields[#fields+1] = repeatJobKey
            end

            rcall('HSET', deduplicationNextKey, unpack(fields))

            -- Ensure the dedup key does not expire while the job is active,
            -- so subsequent adds always hit the dedup path and never bypass
            -- the active-check because of a TTL expiry.
            local deduplicationKey = prefix .. "de:" .. deduplicationId
            rcall('PERSIST', deduplicationKey)

            -- TODO remove debounced event in next breaking change
            rcall("XADD", eventsKey, "MAXLEN", "~", maxEvents, "*", "event", "debounced", "jobId",
                currentDebounceJobId, "debounceId", jobId)
            rcall("XADD", eventsKey, "MAXLEN", "~", maxEvents, "*", "event", "deduplicated", "jobId",
                currentDebounceJobId, "deduplicationId", deduplicationId, "deduplicatedJobId", jobId)
            return true
        end
    end
    return false
end
