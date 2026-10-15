--[[
  Hold a parent's dependencies open while a flow transaction is registered.

  KEYS[1] parent job key
  ARGV[1] parent queue key
  ARGV[2] parent job id
  ARGV[3] timestamp
  ARGV[4] "1" to hold, "0" to release
]]
local rcall = redis.call
local parentKey = KEYS[1]
local dependenciesKey = parentKey .. ":dependencies"

-- Includes
--- @include "includes/moveParentToWaitIfNoPendingDependencies"

if ARGV[4] == "1" then
    -- The dependency-set key cannot also be a child job hash. Using it as the
    -- temporary member avoids colliding with a real child dependency.
    rcall("SADD", dependenciesKey, dependenciesKey)
else
    rcall("SREM", dependenciesKey, dependenciesKey)
    moveParentToWaitIfNoPendingDependencies(ARGV[1], dependenciesKey, parentKey,
        ARGV[2], tonumber(ARGV[3]))
end

return 0
