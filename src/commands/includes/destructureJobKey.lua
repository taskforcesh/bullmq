--[[
  Functions to destructure job key.
]]

local getJobIdFromKey = function (jobKey)
  return string.match(jobKey, ".*:(.*)")
end

local getJobKeyPrefix = function (jobKey, jobId)
  return string.sub(jobKey, 0, #jobKey - #jobId)
end
