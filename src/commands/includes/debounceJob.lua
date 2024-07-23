--[[
  Function to debounce a job.
]]

local function debounceJob(prefixKey, debounceOpts, jobId, debounceKey, eventsKey, maxEvents)
  local debounceId = debounceOpts and debounceOpts['id']
  if debounceId then
    local ttl = debounceOpts['ttl']
    local isFirstSet
    if ttl then
      isFirstSet = rcall('SET', debounceKey, jobId, 'PX', ttl, 'NX')
    else
      isFirstSet = rcall('SET', debounceKey, jobId, 'NX')
    end
    if not isFirstSet then
      local currentDebounceJobId = rcall('GET', debounceKey)
      rcall("XADD", eventsKey, "MAXLEN", "~", maxEvents, "*", "event",
        "debounced", "jobId", currentDebounceJobId)
      return currentDebounceJobId
    end
  end
end
  