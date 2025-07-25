--[[
  Adds a delayed job to the queue by doing the following:
    - Increases the job counter if needed.
    - Creates a new job key with the job data.

    - computes timestamp.
    - adds to delayed zset.
    - Emits a global event 'delayed' if the job is delayed.
    
    Input:
      KEYS[1] 'marker',
      KEYS[2] 'meta'
      KEYS[3] 'id'
      KEYS[4] 'delayed'
      KEYS[5] 'completed'
      KEYS[6] events stream key

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
            [10] deduplication key

      ARGV[2] Json stringified job data
      ARGV[3] msgpacked options

      Output:
        jobId  - OK
        -5     - Missing parent key
]]
local metaKey = KEYS[2]
local idKey = KEYS[3]
local delayedKey = KEYS[4]

local completedKey = KEYS[5]
local eventsKey = KEYS[6]

local jobId
local jobIdKey
local rcall = redis.call

local args = cmsgpack.unpack(ARGV[1])

local data = ARGV[2]

local parentKey = args[5]
local parent = args[8]
local repeatJobKey = args[9]
local deduplicationKey = args[10]
local parentData

-- Includes
--- @include "includes/addDelayedJob"
--- @include "includes/deduplicateJob"
--- @include "includes/getOrSetMaxEvents"
--- @include "includes/handleDuplicatedJob"
--- @include "includes/storeJob"

if parentKey ~= nil then
    if rcall("EXISTS", parentKey) ~= 1 then return -5 end

    parentData = cjson.encode(parent)
end

local jobCounter = rcall("INCR", idKey)

local maxEvents = getOrSetMaxEvents(metaKey)
local opts = cmsgpack.unpack(ARGV[3])

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

local deduplicationJobId = deduplicateJob(opts['de'], jobId, delayedKey, deduplicationKey,
  eventsKey, maxEvents, args[1])
if deduplicationJobId then
  return deduplicationJobId
end

local delay, priority = storeJob(eventsKey, jobIdKey, jobId, args[3], ARGV[2],
    opts, timestamp, parentKey, parentData, repeatJobKey)

addDelayedJob(jobId, delayedKey, eventsKey, timestamp, maxEvents, KEYS[1], delay)

-- Check if this job is a child of another job, if so add it to the parents dependencies
if parentDependenciesKey ~= nil then
    rcall("SADD", parentDependenciesKey, jobIdKey)
end

return jobId .. "" -- convert to string
