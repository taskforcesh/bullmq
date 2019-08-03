--[[
  Retries a failed job by moving it back to the wait queue.

    Input:
      KEYS[1] 'active',
      KEYS[2] 'wait'
      KEYS[3] jobId
      KEYS[4] events stream

      ARGV[1]  pushCmd
      ARGV[2]  jobId
      ARGV[3]  token

    Events:
      'prefix:added'

    Output:
     0  - OK
     -1 - Missing key
]]
local rcall = redis.call

if rcall("EXISTS", KEYS[3]) == 1 then

  rcall("LREM", KEYS[1], 0, ARGV[2])
  rcall(ARGV[1], KEYS[2], ARGV[2])

  -- Emit waiting event
  rcall("XADD", KEYS[4], "*", "event", "waiting", "jobId", ARGV[2], "prev", "failed");
  
  return 0
else
  return -1
end
