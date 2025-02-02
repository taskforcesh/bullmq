--[[
  Function to deduplicate a job.
]]

local function deduplicateJob(deduplicationOpts, jobId, deduplicationKey, eventsKey, maxEvents)
  local deduplicationId = deduplicationOpts and deduplicationOpts['id']
  if deduplicationId then
    local ttl = deduplicationOpts['ttl']
    local deduplicationKeyExists
    if ttl then
      deduplicationKeyExists = rcall('SET', deduplicationKey, jobId, 'PX', ttl, 'NX')
    else
      deduplicationKeyExists = rcall('SET', deduplicationKey, jobId, 'NX')
    end
    if deduplicationKeyExists == false  then
      local currentDeduplicatedJobId = rcall('GET', deduplicationKey)
      rcall("XADD", eventsKey, "MAXLEN", "~", maxEvents, "*", "event",
        "debounced", "jobId", currentDeduplicatedJobId, "debounceId", deduplicationId)
      rcall("XADD", eventsKey, "MAXLEN", "~", maxEvents, "*", "event",
        "deduplicated", "jobId", currentDeduplicatedJobId, "deduplicationId", deduplicationId)
      return currentDeduplicatedJobId
    end
  end
end
