--[[
  Function to debounce a job.
]]

local function debounceJob(prefixKey, debounceOpts, jobId, debounceKey, eventsKey, maxEvents)
  local debounceId = debounceOpts and debounceOpts['id']
  if debounceId then
    local ttl = debounceOpts['ttl']
    local debounceKeyExists
    if ttl then
      debounceKeyExists = not rcall('SET', debounceKey, jobId, 'PX', ttl, 'NX')
    else
      debounceKeyExists = not rcall('SET', debounceKey, jobId, 'NX')
    end
    if debounceKeyExists then
      local currentDebounceJobId = rcall('GET', debounceKey)
      rcall("XADD", eventsKey, "MAXLEN", "~", maxEvents, "*", "event",
        "debounced", "jobId", currentDebounceJobId, "debounceId", debounceId)
      return currentDebounceJobId
    end
  end
end
  