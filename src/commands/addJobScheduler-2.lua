--[[
  Adds a job scheduler, i.e. a job factory that creates jobs based on a given schedule (repeat options).

    Input:
      KEYS[1] 'repeat' key
      KEYS[2] 'delayed' key
      
      ARGV[1] next milliseconds
      ARGV[2] msgpacked options
            [1]  name
            [2]  tz?
            [3]  patten?
            [4]  endDate?
            [5]  every?
      ARGV[3] jobs scheduler id
      ARGV[4] prefix key

      Output:
        repeatableKey  - OK
]]
local rcall = redis.call
local repeatKey = KEYS[1]
local delayedKey = KEYS[2]

local nextMillis = ARGV[1]
local jobSchedulerId = ARGV[3]
local prefixKey = ARGV[4]

-- Includes
--- @include "includes/removeJob"

local function storeRepeatableJob(repeatKey, nextMillis, rawOpts)
  rcall("ZADD", repeatKey, nextMillis, jobSchedulerId)
  local opts = cmsgpack.unpack(rawOpts)

  local optionalValues = {}
  if opts['tz'] then
    table.insert(optionalValues, "tz")
    table.insert(optionalValues, opts['tz'])
  end

  if opts['pattern'] then
    table.insert(optionalValues, "pattern")
    table.insert(optionalValues, opts['pattern'])
  end

  if opts['endDate'] then
    table.insert(optionalValues, "endDate")
    table.insert(optionalValues, opts['endDate'])
  end
  
  if opts['every'] then
    table.insert(optionalValues, "every")
    table.insert(optionalValues, opts['every'])
  end

  rcall("HMSET", repeatKey .. ":" .. jobSchedulerId, "name", opts['name'],
    unpack(optionalValues))
end

-- If we are overriding a repeatable job we must delete the delayed job for
-- the next iteration.
local prevMillis = rcall("ZSCORE", repeatKey, jobSchedulerId)
if prevMillis ~= false then
  local delayedJobId =  "repeat:" .. jobSchedulerId .. ":" .. prevMillis
  local nextDelayedJobId =  repeatKey .. ":" .. jobSchedulerId .. ":" .. nextMillis

  if rcall("ZSCORE", delayedKey, delayedJobId) ~= false
   and rcall("EXISTS", nextDelayedJobId) ~= 1 then
    removeJob(delayedJobId, true, prefixKey, true --[[remove debounce key]])
    rcall("ZREM", delayedKey, delayedJobId)
  end
end

return storeRepeatableJob(repeatKey, nextMillis, ARGV[2])
