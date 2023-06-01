local function getRateLimitTTL(maxJobs, rateLimiterKey)
  if maxJobs then
    local pttl = rcall("PTTL", rateLimiterKey)

    if pttl <= 0 then
      rcall("DEL", rateLimiterKey)
    end

    local jobCounter = tonumber(rcall("GET", rateLimiterKey) or 0)
    if jobCounter >= maxJobs then
      if pttl > 0 then
        return pttl
      end
    end
  end
  return 0
end
