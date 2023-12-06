--[[
  Adds a delayed job to the queue by doing the following:
    - Increases the job counter if needed.
    - Creates a new job key with the job data.

    - computes timestamp.
    - adds to delayed zset.
    - Emits a global event 'delayed' if the job is delayed.
    
    Input:
      KEYS[1] 'wait',
      KEYS[2] 'paused'
      KEYS[3] 'meta'
      KEYS[4] 'id'
      KEYS[5] 'delayed'
      KEYS[6] 'completed'
      KEYS[7] events stream key

      ARGV[1] msgpacked arguments array
            [1]  key prefix,
            [2]  custom id (use custom instead of one generated automatically)
            [3]  name
            [4]  timestamp
            [5]  parentKey?
          x [6]  waitChildrenKey key.
            [7]  parent dependencies key.
            [8]  parent? {id, queueKey}
            [9]  repeat job key
            
      ARGV[2] Json stringified job data
      ARGV[3] msgpacked options

      Output:
        jobId  - OK
        -5     - Missing parent key
]]
local waitKey = KEYS[1]
local pausedKey = KEYS[2]

local metaKey = KEYS[3]
local idKey = KEYS[4]
local delayedKey = KEYS[5]

local completedKey = KEYS[6]
local eventsKey = KEYS[7]

local jobId
local jobIdKey
local rcall = redis.call

local args = cmsgpack.unpack(ARGV[1])

local data = ARGV[2]
local opts = cmsgpack.unpack(ARGV[3])

local parentKey = args[5]
local repeatJobKey = args[9]
local parent = args[8]
local parentData

-- Includes
--- @include "includes/storeJob"
--- @include "includes/addDelayMarkerIfNeeded"
--- @include "includes/getTargetQueueList"
--- @include "includes/getNextDelayedTimestamp"
--- @include "includes/updateExistingJobsParent"
--- @include "includes/getOrSetMaxEvents"

if parentKey ~= nil then
    if rcall("EXISTS", parentKey) ~= 1 then return -5 end

    parentData = cjson.encode(parent)
end

local jobCounter = rcall("INCR", idKey)

local maxEvents = getOrSetMaxEvents(metaKey)

local parentDependenciesKey = args[7]
local timestamp = args[4]
if args[2] == "" then
    jobId = jobCounter
    jobIdKey = args[1] .. jobId
else
    -- Refactor to: handleDuplicateJob.lua
    jobId = args[2]
    jobIdKey = args[1] .. jobId
    if rcall("EXISTS", jobIdKey) == 1 then
        updateExistingJobsParent(parentKey, parent, parentData,
                                 parentDependenciesKey, completedKey, jobIdKey,
                                 jobId, timestamp)
        rcall("XADD", eventsKey, "MAXLEN", "~", maxEvents, "*", "event",
              "duplicated", "jobId", jobId)

        return jobId .. "" -- convert to string
    end
end

-- Store the job.
local delay, priority = storeJob(eventsKey, jobIdKey, jobId, args[3], ARGV[2],
                                 opts, timestamp, parentKey, parentData,
                                 repeatJobKey)

-- Compute delayed timestamp and the score.
local delayedTimestamp = (delay > 0 and (timestamp + delay)) or 0
local score = delayedTimestamp * 0x1000 + bit.band(jobCounter, 0xfff)

rcall("ZADD", delayedKey, score, jobId)
rcall("XADD", eventsKey, "MAXLEN", "~", maxEvents, "*", "event", "delayed",
      "jobId", jobId, "delay", delayedTimestamp)

-- If wait list is empty, and this delayed job is the next one to be processed,
-- then we need to signal the workers by adding a dummy job (jobId 0:delay) to the wait list.
local target = getTargetQueueList(metaKey, KEYS[1], KEYS[2])
addDelayMarkerIfNeeded(target, delayedKey)

-- Check if this job is a child of another job, if so add it to the parents dependencies
-- TODO: Should not be possible to add a child job to a parent that is not in the "waiting-children" status.
-- fail in this case.
if parentDependenciesKey ~= nil then
    rcall("SADD", parentDependenciesKey, jobIdKey)
end

return jobId .. "" -- convert to string
