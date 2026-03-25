--[[
  Function to store a deduplicated next job if the existing job is active
  and keepLastIfActive is set. When the active job finishes, the stored
  proto-job is used to create a real job in the queue.
  Returns true if the proto-job was stored, false otherwise.
]]
local function storeDeduplicatedNextJob(deduplicationOpts, currentDebounceJobId, prefix,
    deduplicationId, jobName, jobData, fullOpts, eventsKey, maxEvents, jobId)
    if deduplicationOpts['keepLastIfActive'] and prefix and currentDebounceJobId then
        local activeKey = prefix .. "active"
        if rcall('LPOS', activeKey, currentDebounceJobId) ~= false then
            local deduplicationNextKey = prefix .. "dn:" .. deduplicationId
            rcall('HSET', deduplicationNextKey, 'name', jobName, 'data', jobData, 'opts', cjson.encode(fullOpts))
            rcall("XADD", eventsKey, "MAXLEN", "~", maxEvents, "*", "event", "deduplicated", "jobId",
                currentDebounceJobId, "deduplicationId", deduplicationId, "deduplicatedJobId", jobId)
            return true
        end
    end
    return false
end
