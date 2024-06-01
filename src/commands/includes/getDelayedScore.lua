--[[
  Bake in the job id first 12 bits into the timestamp
  to guarantee correct execution order of delayed jobs
  (up to 4096 jobs per given timestamp or 4096 jobs apart per timestamp)
  WARNING: Jobs that are so far apart that they wrap around will cause FIFO to fail
]]
local function getDelayedScore(delayedKey, timestamp, delay)
  local delayedTimestamp = (delay > 0 and (tonumber(timestamp) + delay)) or timestamp

  local result = rcall("ZREVRANGEBYSCORE", delayedKey, (delayedTimestamp + 1 ) * 0x1000 - 1,
    delayedTimestamp * 0x1000, "WITHSCORES","LIMIT", 0, 1)
  if #result then
    local maxTimestamp = tonumber(result[2])
    if maxTimestamp ~= nil then
      return maxTimestamp + 1, delayedTimestamp
    end
  end
  return delayedTimestamp * 0x1000, delayedTimestamp
end
