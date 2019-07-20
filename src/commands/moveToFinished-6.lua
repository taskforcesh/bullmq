--[[
  Move job from active to a finished status (completed o failed)
  A job can only be moved to completed if it was active.

     Input:
      KEYS[1] active key
      KEYS[2] completed/failed key
      KEYS[3] jobId key

      KEYS[4] wait key
      KEYS[5] priority key
      KEYS[6] event stream key

      ARGV[1]  jobId
      ARGV[2]  timestamp
      ARGV[3]  msg property
      ARGV[4]  return value / failed reason
      ARGV[5]  target (completed/failed)
      ARGV[6]  shouldRemove
      ARGV[7]  event data (? maybe just send jobid).
      ARGV[8]  fetch next?
      ARGV[9]  keys prefix

     Output:
      0 OK
      -1 Missing key.

     Events:
      'completed/failed'
]]
local rcall = redis.call

if rcall("EXISTS", KEYS[3]) == 1 then -- // Make sure job exists

  -- Remove from active list (if not active we shall return error)
  local numRemovedElements = rcall("LREM", KEYS[1], -1, ARGV[1])

  -- What if we just ignore this?
--[[   if(numRemovedElements < 1) then
    return -2
  end
 ]]
  -- Remove job?
  if ARGV[6] == "1" then
    rcall("DEL", KEYS[3])
  else
    -- Add to complete/failed set
    rcall("ZADD", KEYS[2], ARGV[2], ARGV[1])
    rcall("HMSET", KEYS[3], ARGV[3], ARGV[4], "finishedOn", ARGV[2]) -- "returnvalue" / "failedReason" and "finishedOn"
  end

  -- rcall("PUBLISH", KEYS[2], ARGV[7])
  rcall("XADD", KEYS[6], "*", "event", ARGV[5], "jobId", ARGV[1], ARGV[3], ARGV[4])

  -- Try to get next job to avoid an extra roundtrip if the queue is not closing, 
  -- and not rate limited.
  if(ARGV[8] == "1") then
    -- move from wait to active 
    local jobId = rcall("RPOPLPUSH", KEYS[4], KEYS[1])
    if jobId then
      local jobKey = ARGV[9] .. jobId

      rcall("ZREM", KEYS[5], jobId) -- remove from priority
      rcall("XADD", KEYS[6], "*", "event", "active", "jobId", jobId, "prev", "waiting");
      rcall("HSET", jobKey, "processedOn", ARGV[2]) 

      return {rcall("HGETALL", jobKey), jobId} -- get job data
    end
  end

  return 0
else
  return -1
end
