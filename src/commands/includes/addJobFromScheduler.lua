--[[
  Add delay marker if needed.
]]

-- Includes
--- @include "addDelayedJob"
--- @include "addJobWithPriority"
--- @include "isQueuePaused"
--- @include "storeJob"

local function addJobFromScheduler(jobKey, jobId, rawOpts, waitKey, pausedKey, metaKey, prioritizedKey,
  priorityCounter, delayedKey, markerKey, eventsKey, name, maxEvents, timestamp, data, jobSchedulerId)
  local opts = cmsgpack.unpack(rawOpts)

  local delay, priority = storeJob(eventsKey, jobKey, jobId, name, data,
    opts, timestamp, nil, nil, jobSchedulerId)

  if delay ~= 0 then
    addDelayedJob(jobId, delayedKey, eventsKey, timestamp, maxEvents, markerKey, delay)
  else
    local isPaused = isQueuePaused(metaKey)
  
    -- Standard or priority add
    if priority == 0 then
      if isPaused then
        -- LIFO or FIFO
        local pushCmd = opts['lifo'] and 'RPUSH' or 'LPUSH'
        rcall(pushCmd, pausedKey, jobId)
      else
        -- LIFO or FIFO
        local pushCmd = opts['lifo'] and 'RPUSH' or 'LPUSH'
        rcall(pushCmd, waitKey, jobId)
      end
    else
      -- Priority add
      addJobWithPriority(markerKey, prioritizedKey, priority, jobId, priorityCounter, isPaused)
    end
    -- Emit waiting event
    rcall("XADD", eventsKey, "MAXLEN", "~", maxEvents,  "*", "event", "waiting", "jobId", jobId)
  end
end
