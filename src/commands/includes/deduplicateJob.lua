--[[
  Function to debounce a job.
]] 
local function deduplicateJob(deduplicationOpts, jobId, deduplicationKey, eventsKey, maxEvents)
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
          local currentDebounceJobId = rcall('GET', deduplicationKey)
          rcall("XADD", eventsKey, "MAXLEN", "~", maxEvents, "*", "event", "debounced", "jobId", currentDebounceJobId,
              "debounceId", deduplicationId)
          rcall("XADD", eventsKey, "MAXLEN", "~", maxEvents, "*", "event", "deduplicated", "jobId",
              currentDebounceJobId, "deduplicationId", deduplicationId, "deduplicatedJobId", jobId)
          return currentDebounceJobId
      end
  end
end
