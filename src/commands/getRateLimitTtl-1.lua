--[[
  Get rate limit ttl

    Input:
      KEYS[1] 'limiter'

      ARGV[1] maxJobs
]]

local rcall = redis.call

-- Includes
--- @include "includes/getRateLimitTTL"

local rateLimiterKey = KEYS[1]
if ARGV[1] ~= "0" then
  return getRateLimitTTL(tonumber(ARGV[1]), rateLimiterKey)
else
  return rcall("PTTL", rateLimiterKey)
end
