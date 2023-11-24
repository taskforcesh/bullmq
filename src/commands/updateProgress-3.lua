--[[
  Update job progress

  Input:
    KEYS[1] Job id key
    KEYS[2] event stream key
    KEYS[3] meta key

    ARGV[1] id
    ARGV[2] progress

  Output:
     0 - OK
    -1 - Missing job.

  Event:
    progress(jobId, progress)
]]
local rcall = redis.call

if rcall("EXISTS", KEYS[1]) == 1 then -- // Make sure job exists
    local maxEvents = rcall("HGET", KEYS[3], "opts.maxLenEvents") or 10000

    rcall("HSET", KEYS[1], "progress", ARGV[2])
    rcall("XADD", KEYS[2], "MAXLEN", "~", maxEvents, "*", "event", "progress",
          "jobId", ARGV[1], "data", ARGV[2]);
    return 0
else
    return -1
end
