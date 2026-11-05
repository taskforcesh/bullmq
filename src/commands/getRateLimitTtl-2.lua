--[[
  Get rate limit ttl

    Input:
      KEYS[1] 'limiter'
      KEYS[2] 'meta'

      ARGV[1] maxJobs
]]

local rcall = redis.call

-- Includes
--- @include "includes/getRateLimitTTL"

local rateLimiterKey = KEYS[1]
if ARGV[1] ~= "0" then
  return getRateLimitTTL(tonumber(ARGV[1]), rateLimiterKey)
else
  local rateLimitMax = rcall("HGET", KEYS[2], "max")
  if rateLimitMax then
    return getRateLimitTTL(tonumber(rateLimitMax), rateLimiterKey)
  end

  return rcall("PTTL", rateLimiterKey)
end
