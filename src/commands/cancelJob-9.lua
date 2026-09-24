--[[
  Request cancellation of an active job.

  KEYS[1] active key
  KEYS[2] wait key
  KEYS[3] paused key
  KEYS[4] delayed key
  KEYS[5] completed key
  KEYS[6] failed key
  KEYS[7] waiting-children key
  KEYS[8] prioritized key
  KEYS[9] cancellation channel

  ARGV[1] job id
  ARGV[2] cancellation reason
]]
local rcall = redis.call
local jobId = ARGV[1]

if rcall("ZSCORE", KEYS[5], jobId) then
  return "completed"
end

if rcall("ZSCORE", KEYS[6], jobId) then
  return "failed"
end

local activeItems = rcall("LRANGE", KEYS[1], 0, -1)
for _, item in ipairs(activeItems) do
  if item == jobId then
    rcall("PUBLISH", KEYS[9], cjson.encode({ jobId = jobId, reason = ARGV[2] }))
    return "accepted"
  end
end

if rcall("ZSCORE", KEYS[4], jobId) then
  return "delayed"
end

if rcall("ZSCORE", KEYS[7], jobId) then
  return "waiting-children"
end

if rcall("ZSCORE", KEYS[8], jobId) then
  return "prioritized"
end

local waitItems = rcall("LRANGE", KEYS[2], 0, -1)
for _, item in ipairs(waitItems) do
  if item == jobId then
    return "waiting"
  end
end

local pausedItems = rcall("LRANGE", KEYS[3], 0, -1)
for _, item in ipairs(pausedItems) do
  if item == jobId then
    return "waiting"
  end
end

return "unknown"
