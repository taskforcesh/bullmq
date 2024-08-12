--[[
  Adds a job to the queue by doing the following:
    - Increases the job counter if needed.
    - Creates a new job key with the job data.

    - if delayed:
      - computes timestamp.
      - adds to delayed zset.
      - Emits a global event 'delayed' if the job is delayed.
    - if not delayed
      - Adds the jobId to the wait/paused list in one of three ways:
         - LIFO
         - FIFO
         - prioritized.
      - Adds the job to the "added" list so that workers gets notified.

    Input:
      KEYS[1] 'wait',
      KEYS[2] 'paused'
      KEYS[3] 'meta'
      KEYS[4] 'id'
      KEYS[5] 'completed'
      KEYS[6] 'active'
      KEYS[7] events stream key
      KEYS[8] marker key

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
            [10] debounce key

      ARGV[2] Json stringified job data
      ARGV[3] msgpacked options

      Output:
        jobId  - OK
        -5     - Missing parent key
]]
local eventsKey = KEYS[7]

local jobId
local jobIdKey
local rcall = redis.call

local args = cmsgpack.unpack(ARGV[1])

local data = ARGV[2]
local opts = cmsgpack.unpack(ARGV[3])

local parentKey = args[5]
local parent = args[8]
local repeatJobKey = args[9]
local debounceKey = args[10]
local parentData

-- Includes
--- @include "includes/addJobInTargetList"
--- @include "includes/debounceJob"
--- @include "includes/getOrSetMaxEvents"
--- @include "includes/getTargetQueueList"
--- @include "includes/handleDuplicatedJob"
--- @include "includes/storeJob"

if parentKey ~= nil then
    if rcall("EXISTS", parentKey) ~= 1 then return -5 end

    parentData = cjson.encode(parent)
end

local jobCounter = rcall("INCR", KEYS[4])

local metaKey = KEYS[3]
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
            parentData, parentDependenciesKey, KEYS[5], eventsKey,
            maxEvents, timestamp)
    end
end

local debouncedJobId = debounceJob(args[1], opts['de'],
  jobId, debounceKey, eventsKey, maxEvents)
if debouncedJobId then
  return debouncedJobId
end

-- Store the job.
storeJob(eventsKey, jobIdKey, jobId, args[3], ARGV[2], opts, timestamp,
         parentKey, parentData, repeatJobKey)

local target, isPausedOrMaxed = getTargetQueueList(metaKey, KEYS[6], KEYS[1], KEYS[2])

-- LIFO or FIFO
local pushCmd = opts['lifo'] and 'RPUSH' or 'LPUSH'
addJobInTargetList(target, KEYS[8], pushCmd, isPausedOrMaxed, jobId)

-- Emit waiting event
rcall("XADD", eventsKey, "MAXLEN", "~", maxEvents, "*", "event", "waiting",
      "jobId", jobId)

-- Check if this job is a child of another job, if so add it to the parents dependencies
if parentDependenciesKey ~= nil then
    rcall("SADD", parentDependenciesKey, jobIdKey)
end

return jobId .. "" -- convert to string
