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
--- @include "includes/storeJobScheduler"

local schedulerKey = repeatKey .. ":" .. jobSchedulerId
local nextDelayedJobId =  "repeat:" .. jobSchedulerId .. ":" .. nextMillis
local nextDelayedJobKey =  schedulerKey .. ":" .. nextMillis

-- If we are overriding a repeatable job we must delete the delayed job for
-- the next iteration.
local prevMillis = rcall("ZSCORE", repeatKey, jobSchedulerId)
if prevMillis ~= false then
  local prevDelayedJobId =  "repeat:" .. jobSchedulerId .. ":" .. prevMillis

  if rcall("ZSCORE", delayedKey, prevDelayedJobId) ~= false then
    removeJob(prevDelayedJobId, true, prefixKey, true --[[remove debounce key]])
    rcall("ZREM", delayedKey, prevDelayedJobId)
  end
end

local schedulerOpts = cmsgpack.unpack(ARGV[2])

storeJobScheduler(jobSchedulerId, schedulerKey, repeatKey, nextMillis, schedulerOpts, ARGV[4], templateOpts)

if rcall("EXISTS", nextDelayedJobKey) ~= 1 then
  local eventsKey = KEYS[5]
  local metaKey = KEYS[2]
  local maxEvents = getOrSetMaxEvents(metaKey)

  rcall("INCR", KEYS[3])
  rcall("HINCRBY", schedulerKey, "ic", 1)

  local delayedOpts = cmsgpack.unpack(ARGV[6])

  addDelayedJob(nextDelayedJobKey, nextDelayedJobId, delayedKey, eventsKey, schedulerOpts['name'], ARGV[4], delayedOpts,
    timestamp, jobSchedulerId, maxEvents, KEYS[1], nil, nil)

  if ARGV[9] ~= "" then
    rcall("HSET", ARGV[9], "nrjid", nextDelayedJobId)
  end

  return nextDelayedJobId .. "" -- convert to string
end
