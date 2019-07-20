--[[
  Move next job to be processed to active, lock it and fetch its data. The job
  may be delayed, in that case we need to move it to the delayed set instead.

  Input:
      KEYS[1] wait key
      KEYS[2] active key
      KEYS[3] priority key
      KEYS[4] stream events key
      KEYS[5] stalled key

      -- Rate limiting
      KEYS[6] rate limiter key
      KEYS[7] delayed key

      -- Events
      KEYS[8] events stream key
      KEYS[9] delay stream key

      -- Arguments
      ARGV[1] key prefix
      ARGV[2] timestamp
      ARGV[3] optional jobid

      ARGV[4] optional jobs per time unit (rate limiter)
      ARGV[5] optional time unit (rate limiter)
]]

local jobId
local rcall = redis.call

if(ARGV[3] ~= "") then
  jobId = ARGV[3]

  -- clean stalled key
  rcall("SREM", KEYS[5], jobId)
else
  -- move from wait to active
  jobId = rcall("RPOPLPUSH", KEYS[1], KEYS[2])
end

if jobId then
  -- Check if we need to perform rate limiting.
  local maxJobs = tonumber(ARGV[4])

  if(maxJobs) then
    local rateLimiterKey = KEYS[6];
    local jobCounter = tonumber(rcall("INCR", rateLimiterKey))
    -- check if rate limit hit
    if jobCounter > maxJobs then
      local exceedingJobs = jobCounter - maxJobs
      local delay = tonumber(rcall("PTTL", rateLimiterKey)) + ((exceedingJobs - 1) * ARGV[5]) / maxJobs;
      local timestamp = delay + tonumber(ARGV[2])
      
      -- put job into delayed queue
      rcall("ZADD", KEYS[7], timestamp * 0x1000 + bit.band(jobCounter, 0xfff), jobId);
      rcall("XADD", KEYS[8], "*", "event", "delayed", "jobId", jobId, "delay", timestamp);
      rcall("XADD", KEYS[9], "*", "nextTimestamp", timestamp);
      -- remove from active queue
      rcall("LREM", KEYS[2], 1, jobId)
      return
    else
      if jobCounter == 1 then
        rcall("PEXPIRE", rateLimiterKey, ARGV[5])
      end
    end
  end

  local jobKey = ARGV[1] .. jobId

  rcall("ZREM", KEYS[3], jobId) -- remove from priority

  rcall("XADD", KEYS[4], "*", "event", "active", "jobId", jobId, "prev", "waiting")

  rcall("HSET", jobKey, "processedOn", ARGV[2])

  return {rcall("HGETALL", jobKey), jobId} -- get job data
else
  rcall("XADD", KEYS[8], "*", "event", "drained");
end
