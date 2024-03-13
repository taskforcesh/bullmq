--[[
  Adds a priotitized job to the queue by doing the following:
    - Increases the job counter if needed.
    - Creates a new job key with the job data.
    - Adds the job to the "added" list so that workers gets notified.

    Input:
      KEYS[1] 'marker',
      KEYS[2] 'meta'
      KEYS[3] 'id'
      KEYS[4] 'prioritized'
      KEYS[5] 'completed'
      KEYS[6] events stream key
      KEYS[7] 'pc' priority counter

      ARGV[1] msgpacked arguments array
            [1]  key prefix,
            [2]  custom id (will not generate one automatically)
            [3]  name
            [4]  timestamp
            [5]  parentKey?
            [6]  waitChildrenKey key.
            [7]  parent dependencies key.
            [8]  parent? {id, queueKey}
            [9]  repeat job key
            
      ARGV[2] Json stringified job data
      ARGV[3] msgpacked options

      Output:
        jobId  - OK
        -5     - Missing parent key
]] 
local metaKey = KEYS[2]
local idKey = KEYS[3]
local priorityKey = KEYS[4]

local completedKey = KEYS[5]
local eventsKey = KEYS[6]
local priorityCounterKey = KEYS[7]

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
--- @include "includes/addJobWithPriority"
--- @include "includes/storeJob"
--- @include "includes/getOrSetMaxEvents"
--- @include "includes/handleDuplicatedJob"
--- @include "includes/isQueuePaused"

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
    jobId = args[2]
    jobIdKey = args[1] .. jobId
    if rcall("EXISTS", jobIdKey) == 1 then
        return handleDuplicatedJob(jobIdKey, jobId, parentKey, parent,
            parentData, parentDependenciesKey, completedKey, eventsKey,
            maxEvents, timestamp)
    end
end

-- Store the job.
local delay, priority = storeJob(eventsKey, jobIdKey, jobId, args[3], ARGV[2],
                                 opts, timestamp, parentKey, parentData,
                                 repeatJobKey)

-- Add the job to the prioritized set
local isPause = isQueuePaused(metaKey)
addJobWithPriority( KEYS[1], priorityKey, priority, jobId, priorityCounterKey, isPause)

-- Emit waiting event
rcall("XADD", eventsKey, "MAXLEN", "~", maxEvents, "*", "event", "waiting",
      "jobId", jobId)

-- Check if this job is a child of another job, if so add it to the parents dependencies
if parentDependenciesKey ~= nil then
    rcall("SADD", parentDependenciesKey, jobIdKey)
end

return jobId .. "" -- convert to string
