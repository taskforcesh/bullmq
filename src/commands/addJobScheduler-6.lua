--[[
  Adds a job scheduler, i.e. a job factory that creates jobs based on a given schedule (repeat options).

    Input:
      KEYS[1] 'marker',
      KEYS[2] 'meta'
      KEYS[3] 'id'
      KEYS[4] 'delayed'
      KEYS[5] events stream key
      KEYS[6] 'repeat' key
      
      ARGV[1] next milliseconds
      ARGV[2] msgpacked options
            [1]  name
            [2]  tz?
            [3]  patten?
            [4]  endDate?
            [5]  every?
      ARGV[3] jobs scheduler id
      ARGV[4] Json stringified template data
      ARGV[5] msgpacked template opts
      ARGV[6] msgpacked delayed opts
      ARGV[7] timestamp
      ARGV[8] prefix key
      ARGV[9] producer key

      Output:
        next delayed job id  - OK
]]
local rcall = redis.call
local repeatKey = KEYS[6]
local delayedKey = KEYS[4]
local timestamp = ARGV[7]
local nextMillis = ARGV[1]
local jobSchedulerId = ARGV[3]
local templateOpts = cmsgpack.unpack(ARGV[5])
local prefixKey = ARGV[8]

-- Includes
--- @include "includes/addDelayedJob"
--- @include "includes/getOrSetMaxEvents"
--- @include "includes/removeJob"

local function storeRepeatableJob(schedulerId, schedulerKey, repeatKey, nextMillis, opts, templateData, templateOpts)
  rcall("ZADD", repeatKey, nextMillis, schedulerId)

  local optionalValues = {}
  if opts['tz'] then
    table.insert(optionalValues, "tz")
    table.insert(optionalValues, opts['tz'])
  end

  if opts['limit'] then
    table.insert(optionalValues, "limit")
    table.insert(optionalValues, opts['limit'])
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

  local jsonTemplateOpts = cjson.encode(templateOpts)
  if jsonTemplateOpts and jsonTemplateOpts ~= '{}' then
    table.insert(optionalValues, "opts")
    table.insert(optionalValues, jsonTemplateOpts)
  end

  if templateData and templateData ~= '{}' then
    table.insert(optionalValues, "data")
    table.insert(optionalValues, templateData)
  end

  rcall("HMSET", schedulerKey, "name", opts['name'], "ic", 1,
    unpack(optionalValues))
end

local schedulerKey = repeatKey .. ":" .. jobSchedulerId
local nextDelayedJobId =  "repeat:" .. jobSchedulerId .. ":" .. nextMillis
local nextDelayedJobKey =  schedulerKey .. ":" .. nextMillis

-- If we are overriding a repeatable job we must delete the delayed job for
-- the next iteration.
local prevMillis = rcall("ZSCORE", repeatKey, jobSchedulerId)
if prevMillis ~= false then
  local delayedJobId =  "repeat:" .. jobSchedulerId .. ":" .. prevMillis

  if rcall("ZSCORE", delayedKey, delayedJobId) ~= false
    and (rcall("EXISTS", nextDelayedJobKey) ~= 1 
    or delayedJobId == nextDelayedJobId) then
    removeJob(delayedJobId, true, prefixKey, true --[[remove debounce key]])
    rcall("ZREM", delayedKey, delayedJobId)
  end
end

local schedulerOpts = cmsgpack.unpack(ARGV[2])

storeRepeatableJob(jobSchedulerId, schedulerKey, repeatKey, nextMillis, schedulerOpts, ARGV[4], templateOpts)

local eventsKey = KEYS[5]
local metaKey = KEYS[2]
local maxEvents = getOrSetMaxEvents(metaKey)

rcall("INCR", KEYS[3])

local delayedOpts = cmsgpack.unpack(ARGV[6])

addDelayedJob(nextDelayedJobKey, nextDelayedJobId, delayedKey, eventsKey, schedulerOpts['name'], ARGV[4], delayedOpts,
  timestamp, jobSchedulerId, maxEvents, KEYS[1], nil, nil)

if ARGV[9] ~= "" then
  rcall("HSET", ARGV[9], "nrjid", nextDelayedJobId)
end

return nextDelayedJobId .. "" -- convert to string
