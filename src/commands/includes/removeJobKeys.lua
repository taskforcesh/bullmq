--[[
  Function to remove job keys.
]]

local function removeJobKeys(jobKey)
  return rcall("DEL", jobKey, jobKey .. ':logs',
    jobKey .. ':dependencies', jobKey .. ':processed', jobKey .. ':failed')
end
