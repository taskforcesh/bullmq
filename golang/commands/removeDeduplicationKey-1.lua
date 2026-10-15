--[[
  Remove deduplication key if it matches the job id.

  Input:
    KEYS[1] deduplication key

    ARGV[1] job id

  Output:
    0 - false
    1 - true
]]
local rcall = redis.call
local deduplicationKey = KEYS[1]
local jobId = ARGV[1]

local currentJobId = rcall('GET', deduplicationKey)
if currentJobId and currentJobId == jobId then
  return rcall("DEL", deduplicationKey)
end

return 0
