--[[
  Bake in the job id first 12 bits into the timestamp
  to guarantee correct execution order of delayed jobs
  (up to 4096 jobs per given timestamp or 4096 jobs apart per timestamp)
  WARNING: Jobs that are so far apart that they wrap around will cause FIFO to fail
]]
local function getDelayedScore(jobCounter, delayedKey, timestamp, delay)
  local delayedTimestamp = (delay > 0 and (tonumber(timestamp) + delay)) or 0
  return delayedTimestamp * 0x1000 + bit.band(jobCounter, 0xfff)
end
  