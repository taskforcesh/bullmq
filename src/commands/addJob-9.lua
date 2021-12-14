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
      KEYS[9] delay stream key

      ARGV[1] msgpacked arguments array
            [1]  key prefix,
            [2]  custom id (will not generate one automatically)
            [3]  name
            [4]  timestamp
            [5]  parentKey?
            [6] waitChildrenKey key.
            [7] parent dependencies key.

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
local parentId
local parentQueueKey
local parentData

-- Includes
--- @include "includes/destructureJobKey"

if parentKey ~= nil then
  if rcall("EXISTS", parentKey) ~= 1 then
    return -5
  end

  parentId = getJobIdFromKey(parentKey)
  parentQueueKey = getJobKeyPrefix(parentKey, ":" .. parentId)
  local parent = {}
  parent['id'] = parentId
  parent['queueKey'] = parentQueueKey
  parentData = cjson.encode(parent)
end

local jobCounter = rcall("INCR", KEYS[4])

-- Includes
--- @include "includes/updateParentDepsIfNeeded"

local parentDependenciesKey = args[7]
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
        updateParentDepsIfNeeded(parentKey, parentQueueKey, parentDependenciesKey, parentId, jobIdKey, returnvalue)
      else
        if parentDependenciesKey ~= nil then
          rcall("SADD", parentDependenciesKey, jobIdKey)
        end
      end
      rcall("HMSET", jobIdKey, "parentKey", parentKey, "parent", parentData)
    end
    return jobId .. "" -- convert to string
  end
end

-- Store the job.
local jsonOpts = cjson.encode(opts)
local delay = opts['delay'] or 0
local priority = opts['priority'] or 0
local timestamp = args[4]

if parentKey ~= nil then
  rcall("HMSET", jobIdKey, "name", args[3], "data", ARGV[2], "opts", jsonOpts,
    "timestamp", timestamp, "delay", delay, "priority", priority, "parentKey", parentKey, "parent", parentData)
else
  rcall("HMSET", jobIdKey, "name", args[3], "data", ARGV[2], "opts", jsonOpts,
    "timestamp", timestamp, "delay", delay, "priority", priority )
end

-- TODO: do not send data and opts to the event added (for performance reasons).
rcall("XADD", KEYS[8], "*", "event", "added", "jobId", jobId, "name", args[3], "data", ARGV[2], "opts", jsonOpts)

-- Check if job is delayed
local delayedTimestamp = (delay > 0 and (timestamp + delay)) or 0

-- Check if job is a parent, if so add to the parents set
local waitChildrenKey = args[6]
if waitChildrenKey ~= nil then
    rcall("ZADD", waitChildrenKey, timestamp, jobId)
    rcall("XADD", KEYS[8], "*", "event", "waiting-children", "jobId", jobId)
elseif (delayedTimestamp ~= 0) then
    local timestamp = delayedTimestamp * 0x1000 + bit.band(jobCounter, 0xfff)
    rcall("ZADD", KEYS[5], timestamp, jobId)
    rcall("XADD", KEYS[8], "*", "event", "delayed", "jobId", jobId, "delay",
          delayedTimestamp)
    rcall("XADD", KEYS[9], "*", "nextTimestamp", delayedTimestamp)
else
    local target

    -- We check for the meta.paused key to decide if we are paused or not
    -- (since an empty list and !EXISTS are not really the same)
    local paused
    if rcall("HEXISTS", KEYS[3], "paused") ~= 1 then
        target = KEYS[1]
        paused = false
    else
        target = KEYS[2]
        paused = true
    end

    -- Standard or priority add
    if priority == 0 then
        -- LIFO or FIFO
        local pushCmd = opts['lifo'] and 'RPUSH' or 'LPUSH';
        rcall(pushCmd, target, jobId)
    else
        -- Priority add
        rcall("ZADD", KEYS[6], priority, jobId)
        local count = rcall("ZCOUNT", KEYS[6], 0, priority)

        local len = rcall("LLEN", target)
        local id = rcall("LINDEX", target, len - (count - 1))
        if id then
            rcall("LINSERT", target, "BEFORE", id, jobId)
        else
            rcall("RPUSH", target, jobId)
        end
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

local maxEvents = rcall("HGET", KEYS[3], "opts.maxLenEvents")
if (maxEvents) then rcall("XTRIM", KEYS[8], "MAXLEN", "~", maxEvents) end

return jobId .. "" -- convert to string
