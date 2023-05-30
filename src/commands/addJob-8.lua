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
      KEYS[5] 'delayed'
      KEYS[6] 'priority'
      KEYS[7] 'completed'
      KEYS[8] events stream key

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
--- @include "includes/addDelayMarkerIfNeeded"
--- @include "includes/addJobWithPriority"
--- @include "includes/getTargetQueueList"
--- @include "includes/trimEvents"
--- @include "includes/getNextDelayedTimestamp"
--- @include "includes/updateParentDepsIfNeeded"

if parentKey ~= nil then
  if rcall("EXISTS", parentKey) ~= 1 then
    return -5
  end

  parentData = cjson.encode(parent)
end

local jobCounter = rcall("INCR", KEYS[4])

-- Trim events before emiting them to avoid trimming events emitted in this script
trimEvents(KEYS[3], KEYS[8])

local parentDependenciesKey = args[7]
local timestamp = args[4]
if args[2] == "" then
  jobId = jobCounter
  jobIdKey = args[1] .. jobId
else
  jobId = args[2]
  jobIdKey = args[1] .. jobId
  if rcall("EXISTS", jobIdKey) == 1 then
    if parentKey ~= nil then
      if rcall("ZSCORE", KEYS[7], jobId) ~= false then
        local returnvalue = rcall("HGET", jobIdKey, "returnvalue")
        updateParentDepsIfNeeded(parentKey, parent['queueKey'], parentDependenciesKey,
          parent['id'], jobIdKey, returnvalue, timestamp)
      else
        if parentDependenciesKey ~= nil then
          rcall("SADD", parentDependenciesKey, jobIdKey)
        end
      end
      rcall("HMSET", jobIdKey, "parentKey", parentKey, "parent", parentData)
    end
    rcall("XADD", KEYS[8], "*", "event", "duplicated", "jobId", jobId)

    return jobId .. "" -- convert to string
  end
end

-- Store the job.
local jsonOpts = cjson.encode(opts)
local delay = opts['delay'] or 0
local priority = opts['priority'] or 0

local optionalValues = {}
if parentKey ~= nil then
  table.insert(optionalValues, "parentKey")
  table.insert(optionalValues, parentKey)
  table.insert(optionalValues, "parent")
  table.insert(optionalValues, parentData)
end

if repeatJobKey ~= nil then
  table.insert(optionalValues, "rjk")
  table.insert(optionalValues, repeatJobKey)
end

rcall("HMSET", jobIdKey, "name", args[3], "data", ARGV[2], "opts", jsonOpts,
  "timestamp", timestamp, "delay", delay, "priority", priority, unpack(optionalValues))

rcall("XADD", KEYS[8], "*", "event", "added", "jobId", jobId, "name", args[3])

-- Check if job is delayed
local delayedTimestamp = (delay > 0 and (timestamp + delay)) or 0

-- Check if job is a parent, if so add to the parents set
local waitChildrenKey = args[6]
if waitChildrenKey ~= nil then
  rcall("ZADD", waitChildrenKey, timestamp, jobId)
  rcall("XADD", KEYS[8], "*", "event", "waiting-children", "jobId", jobId)
elseif (delayedTimestamp ~= 0) then
  local score = delayedTimestamp * 0x1000 + bit.band(jobCounter, 0xfff)
  rcall("ZADD", KEYS[5], score, jobId)
  rcall("XADD", KEYS[8], "*", "event", "delayed", "jobId", jobId, "delay",
        delayedTimestamp)
  -- If wait list is empty, and this delayed job is the next one to be processed,
  -- then we need to signal the workers by adding a dummy job (jobId 0:delay) to the wait list.
  local target = getTargetQueueList(KEYS[3], KEYS[1], KEYS[2])
  addDelayMarkerIfNeeded(target, KEYS[5])
else
  local target = getTargetQueueList(KEYS[3], KEYS[1], KEYS[2])

  -- Standard or priority add
  if priority == 0 then
    -- LIFO or FIFO
    local pushCmd = opts['lifo'] and 'RPUSH' or 'LPUSH'
    rcall(pushCmd, target, jobId)
  else
    -- Priority add
    addJobWithPriority(KEYS[6], priority, target, jobId)
  end
  -- Emit waiting event
  rcall("XADD", KEYS[8], "*", "event", "waiting", "jobId", jobId)
end

-- Check if this job is a child of another job, if so add it to the parents dependencies
-- TODO: Should not be possible to add a child job to a parent that is not in the "waiting-children" status.
-- fail in this case.
if parentDependenciesKey ~= nil then
  rcall("SADD", parentDependenciesKey, jobIdKey)
end

return jobId .. "" -- convert to string
