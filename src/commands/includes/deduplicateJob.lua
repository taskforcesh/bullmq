--[[
  Function to deduplicate a job.
]]

local function deduplicateJob(prefixKey, deduplicationOpts, jobId, deduplicationKey, eventsKey, maxEvents)
  local deduplicationId = deduplicationOpts and deduplicationOpts['id']
  if deduplicationId then
    local ttl = deduplicationOpts['ttl']
    local deduplicationKeyExists
    if ttl then
      deduplicationKeyExists = not rcall('SET', deduplicationKey, jobId, 'PX', ttl, 'NX')
    else
      deduplicationKeyExists = not rcall('SET', deduplicationKey, jobId, 'NX')
    end
    if deduplicationKeyExists then
      local currentDeduplicationJobId = rcall('GET', deduplicationKey)
      rcall("XADD", eventsKey, "MAXLEN", "~", maxEvents, "*", "event",
        "deduplicated", "jobId", currentDeduplicationJobId, "deduplicationId", deduplicationId)
      return currentDeduplicationJobId
    end
  end
end
