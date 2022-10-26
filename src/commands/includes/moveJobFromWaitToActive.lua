
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
  local expireTime

  if(maxJobs) then
    local rateLimiterKey = keys[6];
    local jobCounter = tonumber(rcall("INCR", rateLimiterKey))

    if jobCounter == 1 then
      local limiterDuration = opts['limiter'] and opts['limiter']['duration']
      rcall("PEXPIRE", rateLimiterKey, limiterDuration)
    end

    -- check if we passed rate limit, we need to remove the job and return expireTime
    if jobCounter > maxJobs then
      expireTime = rcall("PTTL", rateLimiterKey)
      
      -- remove from active queue and add back to the wait list
      rcall("LREM", keys[2], 1, jobId)
      rcall("RPUSH", keys[1], jobId)

      -- Return when we can process more jobs
      return {0, 0, expireTime}
    else
      if jobCounter == maxJobs then
        expireTime = rcall("PTTL", rateLimiterKey)
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

  return {rcall("HGETALL", jobKey), jobId, expireTime} -- get job data
end
