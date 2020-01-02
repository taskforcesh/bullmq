--[[
  Move job from active to a finished status (completed o failed)
  A job can only be moved to completed if it was active.
  The job must be locked before it can be moved to a finished status,
  and the lock must be released in this script.

     Input:
      KEYS[1] active key
      KEYS[2] completed/failed key
      KEYS[3] jobId key

      KEYS[4] wait key
      KEYS[5] priority key
      KEYS[6] event stream key
      KEYS[7] meta key

      ARGV[1]  jobId
      ARGV[2]  timestamp
      ARGV[3]  msg property
      ARGV[4]  return value / failed reason
      ARGV[5]  target (completed/failed)
      ARGV[6]  shouldRemove
      ARGV[7]  event data (? maybe just send jobid).
      ARGV[8]  fetch next?
      ARGV[9]  keys prefix
      ARGV[10] lock token
      ARGV[11] lock duration in milliseconds

     Output:
      0 OK
      -1 Missing key.
      -2 Missing lock.

     Events:
      'completed/failed'
]] local rcall = redis.call

if rcall("EXISTS", KEYS[3]) == 1 then -- // Make sure job exists

    if ARGV[10] ~= "0" then
      local lockKey = KEYS[3] .. ':lock'
      if rcall("GET", lockKey) == ARGV[10] then
          rcall("DEL", lockKey)
      else
          return -2
      end
    end

    -- Remove from active list (if not active we shall return error)
    local numRemovedElements = rcall("LREM", KEYS[1], -1, ARGV[1])

    -- What if we just ignore this? I think it is good to know regardless.
    --[[   if(numRemovedElements < 1) then
    return -2
  end
 ]]
    -- Remove job?
    local removeJobs = tonumber(ARGV[6])
    if removeJobs ~= 1 then
        -- Add to complete/failed set
        rcall("ZADD", KEYS[2], ARGV[2], ARGV[1])
        rcall("HMSET", KEYS[3], ARGV[3], ARGV[4], "finishedOn", ARGV[2]) -- "returnvalue" / "failedReason" and "finishedOn"

        -- Remove old jobs?
        if removeJobs and removeJobs > 1 then
            local start = removeJobs - 1
            local jobIds = rcall("ZREVRANGE", KEYS[2], start, -1)
            for i, jobId in ipairs(jobIds) do
                local jobKey = ARGV[9] .. jobId
                local jobLogKey = jobKey .. ':logs'
                rcall("DEL", jobKey, jobLogKey)
            end
            rcall("ZREMRANGEBYRANK", KEYS[2], 0, -removeJobs)
        end
    else
        local jobLogKey = KEYS[3] .. ':logs'
        rcall("DEL", KEYS[3], jobLogKey)
    end

    rcall("XADD", KEYS[6], "*", "event", ARGV[5], "jobId", ARGV[1], ARGV[3],
          ARGV[4])

    -- Try to get next job to avoid an extra roundtrip if the queue is not closing,
    -- and not rate limited.
    if (ARGV[8] == "1") then
        -- move from wait to active
        local jobId = rcall("RPOPLPUSH", KEYS[4], KEYS[1])
        if jobId then
            local jobKey = ARGV[9] .. jobId
            local lockKey = jobKey .. ':lock'

            -- get a lock
            if ARGV[10] ~= "0" then
              rcall("SET", lockKey, ARGV[10], "PX", ARGV[11])
            end

            rcall("ZREM", KEYS[5], jobId) -- remove from priority
            rcall("XADD", KEYS[6], "*", "event", "active", "jobId", jobId,
                  "prev", "waiting")
            rcall("HSET", jobKey, "processedOn", ARGV[2])

            return {rcall("HGETALL", jobKey), jobId} -- get job data
        end
    end

    local maxEvents = rcall("HGET", KEYS[7], "opts.maxLenEvents")
    if (maxEvents == false) then
      maxEvents = 10000
    end
    rcall("XTRIM", KEYS[6], "MAXLEN", "~", maxEvents)

    return 0
else
    return -1
end
