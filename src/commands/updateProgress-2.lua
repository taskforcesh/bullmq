--[[
  Update job progress

  Input:
    KEYS[1] Job id key
    KEYS[2] event stream key
  
    ARGV[1] id
    ARGV[2] progress
    
  Event:
    progress(jobId, progress)
]]
local rcall = redis.call

if rcall("EXISTS",KEYS[1]) == 1 then -- // Make sure job exists
  rcall("HSET", KEYS[1], "progress", ARGV[2])
  rcall("XADD", KEYS[2], "*", "event", "progress", "jobId", ARGV[1], "data", ARGV[2]);
  return 0
else
  return -1
end
