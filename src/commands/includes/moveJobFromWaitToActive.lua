
--[[
  Function to move job from wait state to active.
  Input:
    keys[1] wait key
    keys[2] active key
    keys[3] priority key
    keys[4] stream events key
    keys[5] stalled key

    -- Rate limiting
    keys[6] rate limiter key
    keys[7] delayed key

    opts - token - lock token
    opts - lockDuration
    opts - limiter
]]

local function moveJobFromWaitToActive(keys, keyPrefix, jobId, processedOn, opts)
  -- Check if we need to perform rate limiting.
  local maxJobs = tonumber(opts['limiter'] and opts['limiter']['max'])

  if(maxJobs) then
    local rateLimiterKey = keys[6];

    local jobCounter = tonumber(rcall("INCR", rateLimiterKey))

    local limiterDuration = opts['limiter'] and opts['limiter']['duration']
    -- check if rate limit hit
    if jobCounter ~= nil and jobCounter > maxJobs then
      local exceedingJobs = jobCounter - maxJobs
      local expireTime = tonumber(rcall("PTTL", rateLimiterKey))

      -- put job into wait queue
      rcall("LPUSH", keys[1], jobId)

      -- remove from active queue
      rcall("LREM", keys[2], 1, jobId)

      -- Return when we can process more jobs
      return expireTime
    else
      if jobCounter == 1 then
        rcall("PEXPIRE", rateLimiterKey, limiterDuration)
      end
    end
  end

  local jobKey = keyPrefix .. jobId
  local lockKey = jobKey .. ':lock'

  -- get a lock
  if opts['token'] ~= "0" then
    rcall("SET", lockKey, opts['token'], "PX", opts['lockDuration'])
  end

  rcall("ZREM", keys[3], jobId) -- remove from priority
  rcall("XADD", keys[4], "*", "event", "active", "jobId", jobId, "prev", "waiting")
  rcall("HSET", jobKey, "processedOn", processedOn)
  rcall("HINCRBY", jobKey, "attemptsMade", 1)

  return {rcall("HGETALL", jobKey), jobId} -- get job data
end
