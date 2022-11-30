
--[[
  Removes a repeatable job
  Input:
    KEYS[1] repeat jobs key
    KEYS[2] delayed jobs key

    ARGV[1] repeat job id
    ARGV[2] repeat job key
    ARGV[3] queue key

  Output:
    0 - OK
    1 - Missing repeat job
]]
local rcall = redis.call
local millis = rcall("ZSCORE", KEYS[1], ARGV[2])

if(millis) then
  -- Delete next programmed job.
  local repeatJobId = ARGV[1] .. millis
  if(rcall("ZREM", KEYS[2], repeatJobId) == 1) then
    rcall("DEL", ARGV[3] .. repeatJobId)
    rcall("XADD", ARGV[3] .. "events", "*", "event", "removed", "jobId", repeatJobId, "prev", "delayed");
  end
end

if(rcall("ZREM", KEYS[1], ARGV[2]) == 1) then
  return 0
end

return 1
