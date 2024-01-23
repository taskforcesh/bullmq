
--[[
  Function to move job from wait state to active.
  Input:
    keys[1] wait key
    keys[2] active key
    keys[3] prioritized key
    keys[4] stream events key
    keys[5] stalled key

    -- Rate limiting
    keys[6] rate limiter key
    keys[7] delayed key

    keys[8] paused key
    keys[9] meta key
    keys[10] pc priority counter

    opts - token - lock token
    opts - lockDuration
    opts - limiter
]]

local function prepareJobForProcessing(keys, keyPrefix, rateLimiterKey, eventStreamKey,
    jobId, processedOn, maxJobs, opts)
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

  rcall("XADD", eventStreamKey, "*", "event", "active", "jobId", jobId, "prev", "waiting")
  rcall("HSET", jobKey, "processedOn", processedOn)
  rcall("HINCRBY", jobKey, "ats", 1)

  return {rcall("HGETALL", jobKey), jobId, 0, 0} -- get job data
end
