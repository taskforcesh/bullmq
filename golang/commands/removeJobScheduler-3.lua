
--[[
  Removes a job scheduler and its next scheduled job.
  Input:
    KEYS[1] job schedulers key
    KEYS[2] delayed jobs key
    KEYS[3] events key

    ARGV[1] job scheduler id
    ARGV[2] prefix key

  Output:
    0 - OK
    1 - Missing repeat job

  Events:
    'removed'
]]
local rcall = redis.call

-- Includes
--- @include "includes/removeJobKeys"

local jobSchedulerId = ARGV[1]
local prefix = ARGV[2]

local millis = rcall("ZSCORE", KEYS[1], jobSchedulerId)

if millis then
  -- Delete next programmed job.
  local delayedJobId = "repeat:" .. jobSchedulerId .. ":" .. millis
  if(rcall("ZREM", KEYS[2], delayedJobId) == 1) then
    removeJobKeys(prefix .. delayedJobId)
    rcall("XADD", KEYS[3], "*", "event", "removed", "jobId", delayedJobId, "prev", "delayed")
  end
end

if(rcall("ZREM", KEYS[1], jobSchedulerId) == 1) then
  rcall("DEL", KEYS[1] .. ":" .. jobSchedulerId)
  return 0
end

return 1
