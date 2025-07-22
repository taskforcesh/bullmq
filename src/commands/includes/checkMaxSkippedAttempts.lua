--[[
  Function to check max skipped attempts. If allowable limit is exceeded,
  it sets the job deferred failure.
]]

local function checkMaxSkippedAttempts(jobKey, maxSkippedAttemptCount)
  local skippedAttemptCount = rcall("HINCRBY", jobKey, "sac", 1)
  if maxSkippedAttemptCount > 0 and skippedAttemptCount > maxSkippedAttemptCount then
    local failedReason = "job skipped more than allowable attempts"
    rcall("HSET", jobKey, "defa", failedReason)
  end
end
