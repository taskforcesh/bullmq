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
redis.call("HSET", KEYS[1], "progress", ARGV[2])
redis.call("XADD", KEYS[2], "*", "event", "progress", "jobId", ARGV[1], "data", ARGV[2]);
