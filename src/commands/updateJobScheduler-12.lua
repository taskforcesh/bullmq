--[[
  Updates a job scheduler and adds next delayed job

  Input:
    KEYS[1]  'repeat' key
    KEYS[2]  'delayed'
    KEYS[3]  'wait' key
    KEYS[4]  'paused' key
    KEYS[5]  'meta'
    KEYS[6]  'prioritized' key
    KEYS[7]  'marker',
    KEYS[8]  'id'
    KEYS[9]  events stream key
    KEYS[10] 'pc' priority counter
    KEYS[11] producer key
    KEYS[12] 'active' key

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
local repeatKey = KEYS[1]
local delayedKey = KEYS[2]
local waitKey = KEYS[3]
local pausedKey = KEYS[4]
local metaKey = KEYS[5]
local prioritizedKey = KEYS[6]
local nextMillis = ARGV[1]
local jobSchedulerId = ARGV[2]
local timestamp = ARGV[5]
local prefixKey = ARGV[6]
local producerId = ARGV[7]

-- Includes
--- @include "includes/addJobFromScheduler"
--- @include "includes/getOrSetMaxEvents"

local schedulerKey = repeatKey .. ":" .. jobSchedulerId
local nextDelayedJobId = "repeat:" .. jobSchedulerId .. ":" .. nextMillis
local nextDelayedJobKey = schedulerKey .. ":" .. nextMillis

-- Validate that scheduler exists.
local prevMillis = rcall("ZSCORE", repeatKey, jobSchedulerId)
if prevMillis then
    local currentDelayedJobId = "repeat:" .. jobSchedulerId .. ":" .. prevMillis

    if producerId == currentDelayedJobId then
        local eventsKey = KEYS[9]
        local maxEvents = getOrSetMaxEvents(metaKey)

        if rcall("EXISTS", nextDelayedJobKey) ~= 1 then
            local schedulerAttributes = rcall("HMGET", schedulerKey, "name", "data")

            rcall("ZADD", repeatKey, nextMillis, jobSchedulerId)
            rcall("HINCRBY", schedulerKey, "ic", 1)

            rcall("INCR", KEYS[8])

            -- TODO: remove this workaround in next breaking change,
            -- all job-schedulers must save job data
            local templateData = schedulerAttributes[2] or ARGV[3]

            if templateData and templateData ~= '{}' then
                rcall("HSET", schedulerKey, "data", templateData)
            end

            addJobFromScheduler(nextDelayedJobKey, nextDelayedJobId, ARGV[4], waitKey, pausedKey, 
                KEYS[12], metaKey, prioritizedKey, KEYS[10], delayedKey, KEYS[7], eventsKey, 
                schedulerAttributes[1], maxEvents, ARGV[5], templateData or '{}', jobSchedulerId)

            -- TODO: remove this workaround in next breaking change
            if KEYS[11] ~= "" then
                rcall("HSET", KEYS[11], "nrjid", nextDelayedJobId)
            end

            return nextDelayedJobId .. "" -- convert to string
        else
            rcall("XADD", eventsKey, "MAXLEN", "~", maxEvents, "*", "event",
                "duplicated", "jobId", nextDelayedJobId)
        end
    end
end
