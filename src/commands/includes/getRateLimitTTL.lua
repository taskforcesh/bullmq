--[[
  Function to get current rate limit ttl.
]]
local function getRateLimitTTL(maxJobs, rateLimiterKey)
  if not maxJobs then
    return 0
  end

  if maxJobs <= tonumber(rcall("GET", rateLimiterKey) or 0) then
    local pttl = rcall("PTTL", rateLimiterKey)

    if pttl == 0 then
      rcall("DEL", rateLimiterKey)
    end

    if pttl > 0 then
      return pttl
    end
  end
  return 0
end
