--[[
  Adds a job scheduler, i.e. a job factory that creates jobs based on a given schedule (repeat options).

    Input:
      KEYS[1] 'repeat' key
      KEYS[2] 'delayed' key
      KEYS[3] 'wait' key
      KEYS[4] 'paused' key
      KEYS[5] 'meta' key
      KEYS[6] 'prioritized' key
      
      ARGV[1] next milliseconds
      ARGV[2] msgpacked options
            [1]  name
            [2]  tz?
            [3]  patten?
            [4]  endDate?
            [5]  every?
      ARGV[3] jobs scheduler id
      ARGV[4] Json stringified template data
      ARGV[5] mspacked template opts
      ARGV[6] prefix key

      Output:
        repeatableKey  - OK
]] local rcall = redis.call
local repeatKey = KEYS[1]
local delayedKey = KEYS[2]
local prioritizedKey = KEYS[6]

local nextMillis = ARGV[1]
local jobSchedulerId = ARGV[3]
local templateOpts = cmsgpack.unpack(ARGV[5])
local prefixKey = ARGV[6]

-- Includes
--- @include "includes/isQueuePaused"
--- @include "includes/removeJob"
--- @include "includes/storeJobScheduler"

-- If we are overriding a repeatable job we must delete the delayed job for
-- the next iteration.
local schedulerKey = repeatKey .. ":" .. jobSchedulerId
local prevMillis = rcall("ZSCORE", repeatKey, jobSchedulerId)
if prevMillis ~= false then
    local currentJobId = "repeat:" .. jobSchedulerId .. ":" .. prevMillis
    local nextDelayedJobId = "repeat:" .. jobSchedulerId .. ":" .. nextMillis
    local nextDelayedJobKey = schedulerKey .. ":" .. nextMillis

    if rcall("EXISTS", nextDelayedJobKey) ~= 1 or currentJobId == nextDelayedJobId then
        if rcall("ZSCORE", delayedKey, currentJobId) ~= false then
            removeJob(currentJobId, true, prefixKey, true --[[remove debounce key]] )
            rcall("ZREM", delayedKey, currentJobId)
        elseif rcall("ZSCORE", prioritizedKey, currentJobId) ~= false then
            removeJob(currentJobId, true, prefixKey, true --[[remove debounce key]] )
            rcall("ZREM", prioritizedKey, currentJobId)
        else
            if isQueuePaused(KEYS[5]) then
                if rcall("LREM", KEYS[4], 1, currentJobId) > 0 then
                    removeJob(currentJobId, true, prefixKey, true --[[remove debounce key]] )
                end
            else
                if rcall("LREM", KEYS[3], 1, currentJobId) > 0 then
                    removeJob(currentJobId, true, prefixKey, true --[[remove debounce key]] )
                end
            end
        end
    end
end

local schedulerOpts = cmsgpack.unpack(ARGV[2])
return storeJobScheduler(jobSchedulerId, schedulerKey, repeatKey, nextMillis, schedulerOpts, ARGV[4], templateOpts)
