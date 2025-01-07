--[[
  Updates a job scheduler and adds next delayed job

    Input:
      KEYS[1] 'marker',
      KEYS[2] 'meta'
      KEYS[3] 'id'
      KEYS[4] 'delayed'
      KEYS[5] events stream key
      KEYS[6] 'repeat' key
      
      ARGV[1] next milliseconds
      ARGV[2] jobs scheduler id
      ARGV[3] msgpacked delayed opts
      ARGV[4] timestamp
      ARGV[5] prefix key
      ARGV[6] producer key

      Output:
        next delayed job id  - OK
]]
local rcall = redis.call
local repeatKey = KEYS[6]
local delayedKey = KEYS[4]
local timestamp = ARGV[4]
local nextMillis = ARGV[1]
local jobSchedulerId = ARGV[2]
local prefixKey = ARGV[5]

-- Includes
--- @include "includes/addDelayedJob"
--- @include "includes/getOrSetMaxEvents"

local schedulerKey = repeatKey .. ":" .. jobSchedulerId
local nextDelayedJobId =  "repeat:" .. jobSchedulerId .. ":" .. nextMillis
local nextDelayedJobKey =  schedulerKey .. ":" .. nextMillis

-- Validate that scheduler exists.
local prevMillis = rcall("ZSCORE", repeatKey, jobSchedulerId)
if prevMillis ~= false then
    local schedulerAttributes = rcall("HMGET", schedulerKey, "name", "data")

    rcall("ZADD", repeatKey, nextMillis, jobSchedulerId)
    
    local eventsKey = KEYS[5]
    local metaKey = KEYS[2]
    local maxEvents = getOrSetMaxEvents(metaKey)
    
    rcall("INCR", KEYS[3])
    
    local delayedOpts = cmsgpack.unpack(ARGV[3])
    
    addDelayedJob(nextDelayedJobKey, nextDelayedJobId, delayedKey, eventsKey, schedulerAttributes[1],
      schedulerAttributes[2] or "{}", delayedOpts, timestamp, jobSchedulerId, maxEvents, KEYS[1], nil, nil)
    
    if ARGV[6] ~= "" then
      rcall("HSET", ARGV[6], "nrjid", nextDelayedJobId)
    end
    
    return nextDelayedJobId .. "" -- convert to string    
end
