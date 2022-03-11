--[[
  Move next job to be processed to active, lock it and fetch its data. The job
  may be delayed, in that case we need to move it to the delayed set instead.

  This operation guarantees that the worker owns the job during the lock
  expiration time. The worker is responsible of keeping the lock fresh
  so that no other worker picks this job again.

  Input:
      KEYS[1] wait key
      KEYS[2] active key
      KEYS[3] priority key
      KEYS[4] stream events key
      KEYS[5] stalled key

      -- Rate limiting
      KEYS[6] rate limiter key
      KEYS[7] delayed key

      -- Delay events
      KEYS[8] delay stream key

      -- Arguments
      ARGV[1] key prefix
      ARGV[2] timestamp
      ARGV[3] optional job ID
      ARGV[4] opts

      opts - token - lock token
      opts - lockDuration
      opts - limiter
]]

local jobId
local rcall = redis.call

-- Includes
--- @include "includes/moveJobFromWaitToActive"

if(ARGV[3] ~= "") then
  jobId = ARGV[3]

  -- clean stalled key
  rcall("SREM", KEYS[5], jobId)
else
  -- no job ID, try non-blocking move from wait to active
  jobId = rcall("RPOPLPUSH", KEYS[1], KEYS[2])
end

if jobId then
  local opts = cmsgpack.unpack(ARGV[4])

  -- Check if we need to perform rate limiting.
  local maxJobs = tonumber(opts['limiter'] and opts['limiter']['max'])

  if(maxJobs) then
    local rateLimiterKey = KEYS[6];

    local groupKey
    local groupKeyOpt = opts['limiter'] and opts['limiter']['groupKey'] or ""
    if groupKeyOpt ~= "" then
      groupKey = string.match(jobId, "[^:]+$")
      if groupKey ~= jobId then
        rateLimiterKey = rateLimiterKey .. ":" .. groupKey
      end
    end

    local jobCounter
    
    if groupKey ~= nil then
      if rateLimiterKey ~= KEYS[6] then
        jobCounter = tonumber(rcall("INCR", rateLimiterKey))
      end
    else
      jobCounter = tonumber(rcall("INCR", rateLimiterKey))
    end

    local limiterDuration = opts['limiter'] and opts['limiter']['duration']
    -- check if rate limit hit
    if jobCounter ~= nil and jobCounter > maxJobs then
      local exceedingJobs = jobCounter - maxJobs
      local expireTime = tonumber(rcall("PTTL", rateLimiterKey))
      local delay = expireTime + ((exceedingJobs - 1) * limiterDuration) / maxJobs;
      local timestamp = delay + tonumber(ARGV[2])

      -- put job into delayed queue
      rcall("ZADD", KEYS[7], timestamp * 0x1000 + bit.band(jobCounter, 0xfff), jobId);
      rcall("XADD", KEYS[4], "*", "event", "delayed", "jobId", jobId, "delay", timestamp);
      rcall("XADD", KEYS[8], "*", "nextTimestamp", timestamp);
      -- remove from active queue
      rcall("LREM", KEYS[2], 1, jobId)

      -- Return when we can process more jobs
      return expireTime
    else
      if jobCounter == 1 then
        rcall("PEXPIRE", rateLimiterKey, limiterDuration)
      end
    end
  end

  local jobKey = ARGV[1] .. jobId
  local lockKey = jobKey .. ':lock'

  -- get a lock
  rcall("SET", lockKey, opts['token'], "PX", opts['lockDuration'])

  moveJobFromWaitToActive(KEYS[1], KEYS[3], KEYS[4], jobKey, jobId, ARGV[2])

  return {rcall("HGETALL", jobKey), jobId} -- get job data
end
