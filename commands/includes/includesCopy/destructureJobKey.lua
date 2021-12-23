--[[
  Functions to destructure job key.
  Just a bit of warning, these functions may be a bit slow and affect performance significantly.
]]

local getJobIdFromKey = function (jobKey)
  return string.match(jobKey, ".*:(.*)")
end

local getJobKeyPrefix = function (jobKey, jobId)
  return string.sub(jobKey, 0, #jobKey - #jobId)
end
