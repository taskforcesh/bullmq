--[[
  Function to get current rate limit ttl.
]]
local function getRateLimitTTL(maxJobs, rateLimiterKey)
  if maxJobs then
    -- Check if key exists first to avoid unnecessary GET on non-existent keys
    if rcall("EXISTS", rateLimiterKey) == 1 then
      local currentCount = tonumber(rcall("GET", rateLimiterKey))
      if currentCount and maxJobs <= currentCount then
        local pttl = rcall("PTTL", rateLimiterKey)
        if pttl > 0 then
          return pttl
        elseif pttl == 0 then
          rcall("DEL", rateLimiterKey)
        end
      end
    end
  end
  return 0
end
