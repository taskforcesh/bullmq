const content = `--[[
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
      -- Promote delayed jobs
      KEYS[8] paused key
      KEYS[9] meta key
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
      if rateLimiterKey ~= keys[6] then
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
      local timestamp = delay + tonumber(processedOn)
      -- put job into delayed queue
      rcall("ZADD", keys[7], timestamp * 0x1000 + bit.band(jobCounter, 0xfff), jobId);
      rcall("XADD", keys[4], "*", "event", "delayed", "jobId", jobId, "delay", timestamp);
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
--[[
  Function to return the next delayed job timestamp.
]] 
local function getNextDelayedTimestamp(delayedKey)
    local result = rcall("ZRANGE", delayedKey, 0, 0, "WITHSCORES")
    if #result then
      local nextTimestamp = tonumber(result[2])
      if (nextTimestamp ~= nil) then 
        nextTimestamp = nextTimestamp / 0x1000
      end
      return nextTimestamp
    end
end
--[[
  Updates the delay set, by moving delayed jobs that should
  be processed now to "wait".
     Events:
      'waiting'
]]
local rcall = redis.call
-- Includes
--[[
  Function to add job considering priority.
]]
local function addJobWithPriority(priorityKey, priority, targetKey, jobId)
  rcall("ZADD", priorityKey, priority, jobId)
  local count = rcall("ZCOUNT", priorityKey, 0, priority)
  local len = rcall("LLEN", targetKey)
  local id = rcall("LINDEX", targetKey, len - (count - 1))
  if id then
    rcall("LINSERT", targetKey, "BEFORE", id, jobId)
  else
    rcall("RPUSH", targetKey, jobId)
  end
end
--[[
  Function to check for the meta.paused key to decide if we are paused or not
  (since an empty list and !EXISTS are not really the same).
]]
local function getTargetQueueList(queueMetaKey, waitKey, pausedKey)
  if rcall("HEXISTS", queueMetaKey, "paused") ~= 1 then
    return waitKey
  else
    return pausedKey
  end
end
-- Try to get as much as 1000 jobs at once, and returns the nextTimestamp if
-- there are more delayed jobs to process.
local function promoteDelayedJobs(delayedKey, waitKey, priorityKey, pausedKey,
                                  metaKey, eventStreamKey, prefix, timestamp)
    local jobs = rcall("ZRANGEBYSCORE", delayedKey, 0, (timestamp + 1) * 0x1000, "LIMIT", 0, 1000)
    if (#jobs > 0) then
        rcall("ZREM", delayedKey, unpack(jobs))
        -- check if we need to use push in paused instead of waiting
        local target = getTargetQueueList(metaKey, waitKey, pausedKey)
        for _, jobId in ipairs(jobs) do
            local priority =
                tonumber(rcall("HGET", prefix .. jobId, "priority")) or 0
            if priority == 0 then
                -- LIFO or FIFO
                rcall("LPUSH", target, jobId)
            else
                addJobWithPriority(priorityKey, priority, target, jobId)
            end
            -- Emit waiting event
            rcall("XADD", eventStreamKey, "*", "event", "waiting", "jobId",
                  jobId, "prev", "delayed")
            rcall("HSET", prefix .. jobId, "delay", 0)
        end
    end
    local nextTimestamp = rcall("ZRANGE", delayedKey, 0, 0, "WITHSCORES")[2]
    if (nextTimestamp ~= nil) then
        nextTimestamp = nextTimestamp / 0x1000
    end
    return nextTimestamp
end
-- Check if there are delayed jobs that we can move to wait.
promoteDelayedJobs(KEYS[7], KEYS[1], KEYS[3], KEYS[8], KEYS[9], KEYS[4], ARGV[1], ARGV[2])
if (ARGV[3] ~= "") then
    jobId = ARGV[3]
    -- clean stalled key
    rcall("SREM", KEYS[5], jobId)
else
    -- no job ID, try non-blocking move from wait to active
    jobId = rcall("RPOPLPUSH", KEYS[1], KEYS[2])
end
-- If jobId is special ID 0, then there is no job to process
if jobId == "0" then
    rcall("LREM", KEYS[2], 1, 0)
elseif jobId then
    local opts = cmsgpack.unpack(ARGV[4])
    -- this script is not really moving, it is preparing the job for processing
    return moveJobFromWaitToActive(KEYS, ARGV[1], jobId, ARGV[2], opts)
end
-- Return the timestamp for the next delayed job if any.
local nextTimestamp = getNextDelayedTimestamp(KEYS[7])
if (nextTimestamp ~= nil) then
    return nextTimestamp - tonumber(ARGV[2])
end
`;
export const moveToActive = {
  name: 'moveToActive',
  content,
  keys: 9,
};
