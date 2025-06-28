--[[
  Function to move job from wait state to active.
  Input:
    opts - token - lock token
    opts - lockDuration
    opts - limiter
]]

-- Includes
--- @include "addBaseMarkerIfNeeded"

local function getRateLimitDelay(rateLimiterKey, maxJobs, limiterOpts)
  -- Check if we need to perform rate limiting.
  if maxJobs then
    local jobCounter = tonumber(rcall("INCR", rateLimiterKey))

    local limiterDuration = limiterOpts and limiterOpts['duration']
    local integerDuration = math.floor(math.abs(limiterDuration))
    
    if jobCounter == 1 then
      rcall("PEXPIRE", rateLimiterKey, integerDuration)
    end

    if maxJobs <= jobCounter then
      return integerDuration
    end
  end

  return 0
end

local function prepareJobForProcessing(keyPrefix, rateLimiterKey, eventStreamKey,
    jobId, processedOn, maxJobs, markerKey, opts)
  local jobKey = keyPrefix .. jobId

  local rateLimitDelay = getRateLimitDelay(rateLimiterKey, maxJobs, opts['limiter'])

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

  return {rcall("HGETALL", jobKey), jobId, rateLimitDelay, 0} -- get job data
end
