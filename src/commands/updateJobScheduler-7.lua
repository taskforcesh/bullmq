--[[
  Updates a job scheduler and adds next delayed job

  Input:
    KEYS[1] 'marker',
    KEYS[2] 'meta'
    KEYS[3] 'id'
    KEYS[4] 'delayed'
    KEYS[5] events stream key
    KEYS[6] 'repeat' key
    KEYS[7] producer key

    ARGV[1] next milliseconds
    ARGV[2] jobs scheduler id
    ARGV[3] Json stringified delayed data
    ARGV[4] msgpacked delayed opts
    ARGV[5] timestamp
    ARGV[6] prefix key
    ARGV[7] producer id

    Output:
      next delayed job id  - OK
]]
local rcall = redis.call
local repeatKey = KEYS[6]
local delayedKey = KEYS[4]
local nextMillis = ARGV[1]
local jobSchedulerId = ARGV[2]
local timestamp = ARGV[5]
local prefixKey = ARGV[6]
local producerId = ARGV[7]

-- Includes
--- @include "includes/addDelayedJob"
--- @include "includes/getOrSetMaxEvents"

local schedulerKey = repeatKey .. ":" .. jobSchedulerId
local nextDelayedJobId =  "repeat:" .. jobSchedulerId .. ":" .. nextMillis
local nextDelayedJobKey =  schedulerKey .. ":" .. nextMillis

-- Validate that scheduler exists.
local prevMillis = rcall("ZSCORE", repeatKey, jobSchedulerId)
if prevMillis ~= false then
  local currentDelayedJobId =  "repeat:" .. jobSchedulerId .. ":" .. prevMillis

  if producerId == currentDelayedJobId then
    local schedulerAttributes = rcall("HMGET", schedulerKey, "name", "data")

    rcall("ZADD", repeatKey, nextMillis, jobSchedulerId)
    rcall("HINCRBY", schedulerKey, "ic", 1)

    local eventsKey = KEYS[5]
    local metaKey = KEYS[2]
    local maxEvents = getOrSetMaxEvents(metaKey)

    rcall("INCR", KEYS[3])

    local delayedOpts = cmsgpack.unpack(ARGV[4])

    -- TODO: remove this workaround in next breaking change,
    -- all job-schedulers must save job data
    local templateData = schedulerAttributes[2] or ARGV[3]

    if templateData and templateData ~= '{}' then
      rcall("HSET", schedulerKey, "data", templateData)
    end

    addDelayedJob(nextDelayedJobKey, nextDelayedJobId, delayedKey, eventsKey, schedulerAttributes[1],
      templateData or '{}', delayedOpts, timestamp, jobSchedulerId, maxEvents, KEYS[1], nil, nil)
  
    if KEYS[7] ~= "" then
      rcall("HSET", KEYS[7], "nrjid", nextDelayedJobId)
    end

    return nextDelayedJobId .. "" -- convert to string
  end
end
