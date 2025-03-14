
--[[
  Function to move job from wait state to active.
  Input:
    opts - token - lock token
    opts - lockDuration
    opts - limiter
]]

-- Includes
--- @include "addBaseMarkerIfNeeded"

local function getRepeatJobKey(jobAttributes)
  for i = 1, #jobAttributes, 2 do
    if jobAttributes[i] == "rjk" then
      return jobAttributes[i + 1]
    end
  end
end

local function prepareJobForProcessing(keyPrefix, rateLimiterKey, eventStreamKey,
    jobId, processedOn, maxJobs, markerKey, opts)
  local jobKey = keyPrefix .. jobId

  -- Check if we need to perform rate limiting.
  if maxJobs then
    local jobCounter = tonumber(rcall("INCR", rateLimiterKey))

    if jobCounter == 1 then
      local limiterDuration = opts['limiter'] and opts['limiter']['duration']
      local integerDuration = math.floor(math.abs(limiterDuration))
      rcall("PEXPIRE", rateLimiterKey, integerDuration)
    end
  end

  local lockKey = jobKey .. ':lock'

  -- get a lock
  if opts['token'] ~= "0" then
    rcall("SET", lockKey, opts['token'], "PX", opts['lockDuration'])
  end

  local optionalValues = {}

  if opts['name'] then
    -- Set "processedBy" field to the worker name
    table.insert(optionalValues, "pb")
    table.insert(optionalValues, opts['name'])
  end

  rcall("XADD", eventStreamKey, "*", "event", "active", "jobId", jobId, "prev", "waiting")
  rcall("HMSET", jobKey, "processedOn", processedOn, unpack(optionalValues))
  rcall("HINCRBY", jobKey, "ats", 1)

  addBaseMarkerIfNeeded(markerKey, false)

  local jobAttributes = rcall("HGETALL", jobKey)

  local repeatJobKey = getRepeatJobKey(jobAttributes)

  if repeatJobKey then
    return {jobAttributes, jobId, rcall("HGETALL", keyPrefix .. "repeat:" .. repeatJobKey), 0, 0}
  end

  return {jobAttributes, jobId, 0, 0, 0} -- get job data
end
