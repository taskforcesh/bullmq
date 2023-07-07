
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

-- Includes
--- @include "pushBackJobWithPriority"

local function prepareJobForProcessing(keys, keyPrefix, targetKey, jobId, processedOn,
    maxJobs, expireTime, opts)
  local jobKey = keyPrefix .. jobId

  -- Check if we need to perform rate limiting.
  if maxJobs then
    local rateLimiterKey = keys[6];

    -- check if we exceeded rate limit, we need to remove the job and return expireTime
    if expireTime > 0 then
      -- remove from active queue and add back to the wait list
      rcall("LREM", keys[2], 1, jobId)

      local priority = tonumber(rcall("HGET", jobKey, "priority")) or 0

      if priority == 0 then
        rcall("RPUSH", targetKey, jobId)
      else
        pushBackJobWithPriority(keys[3], priority, jobId)
      end

      -- Return when we can process more jobs
      return {0, 0, expireTime, 0}
    end

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

  rcall("XADD", keys[4], "*", "event", "active", "jobId", jobId, "prev", "waiting")
  rcall("HSET", jobKey, "processedOn", processedOn)
  rcall("HINCRBY", jobKey, "attemptsMade", 1)

  return {rcall("HGETALL", jobKey), jobId, 0, 0} -- get job data
end
