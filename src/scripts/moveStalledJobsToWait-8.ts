const content = `--[[
  Move stalled jobs to wait.
    Input:
      KEYS[1] 'stalled' (SET)
      KEYS[2] 'wait',   (LIST)
      KEYS[3] 'active', (LIST)
      KEYS[4] 'failed', (ZSET)
      KEYS[5] 'stalled-check', (KEY)
      KEYS[6] 'meta', (KEY)
      KEYS[7] 'paused', (LIST)
      KEYS[8] 'event stream' (STREAM)
      ARGV[1]  Max stalled job count
      ARGV[2]  queue.toKey('')
      ARGV[3]  timestamp
      ARGV[4]  max check time
    Events:
      'stalled' with stalled job id.
]] -- Includes
--[[
  Move stalled jobs to wait.
    Input:
      stalledKey 'stalled' (SET)
      waitKey 'wait',   (LIST)
      activeKey 'active', (LIST)
      failedKey 'failed', (ZSET)
      stalledCheckKey 'stalled-check', (KEY)
      metaKey 'meta', (KEY)
      pausedKey 'paused', (LIST)
      eventStreamKey 'event stream' (STREAM)
      maxStalledJobCount  Max stalled job count
      queueKeyPrefix  queue.toKey('')
      timestamp  timestamp
      maxCheckTime  max check time
    Events:
      'stalled' with stalled job id.
]] local rcall = redis.call
-- Includes
--[[
  Function to loop in batches.
  Just a bit of warning, some commands as ZREM
  could receive a maximum of 7000 parameters per call.
]]
local function batches(n, batchSize)
  local i = 0
  return function()
    local from = i * batchSize + 1
    i = i + 1
    if (from <= n) then
      local to = math.min(from + batchSize - 1, n)
      return from, to
    end
  end
end
--[[
  Function to check for the meta.paused key to decide if we are paused or not
  (since an empty list and !EXISTS are not really the same).
]]
local function getTargetQueueList(queueMetaKey, waitKey, pausedKey)
  if rcall("HEXISTS", queueMetaKey, "paused") ~= 1 then
    return waitKey
  else
    return pausedKey
  end
end
--[[
  Function to remove job.
]]
-- Includes
--[[
  Check if this job has a parent. If so we will just remove it from
  the parent child list, but if it is the last child we should move the parent to "wait/paused"
  which requires code from "moveToFinished"
]]
--[[
  Functions to destructure job key.
  Just a bit of warning, these functions may be a bit slow and affect performance significantly.
]]
local getJobIdFromKey = function (jobKey)
  return string.match(jobKey, ".*:(.*)")
end
local getJobKeyPrefix = function (jobKey, jobId)
  return string.sub(jobKey, 0, #jobKey - #jobId)
end
local function moveParentToWait(parentPrefix, parentId, emitEvent)
  local parentTarget = getTargetQueueList(parentPrefix .. "meta", parentPrefix .. "wait", parentPrefix .. "paused")
  rcall("RPUSH", parentTarget, parentId)
  if emitEvent then
    local parentEventStream = parentPrefix .. "events"
    rcall("XADD", parentEventStream, "*", "event", "waiting", "jobId", parentId, "prev", "waiting-children")
  end
end
local function removeParentDependencyKey(jobKey, hard, parentKey, baseKey)
  if parentKey then
    local parentProcessedKey = parentKey .. ":processed"
    rcall("HDEL", parentProcessedKey, jobKey)
    local parentDependenciesKey = parentKey .. ":dependencies"
    local result = rcall("SREM", parentDependenciesKey, jobKey)
    if result > 0 then
      local pendingDependencies = rcall("SCARD", parentDependenciesKey)
      if pendingDependencies == 0 then
        local parentId = getJobIdFromKey(parentKey)
        local parentPrefix = getJobKeyPrefix(parentKey, parentId)
        local numRemovedElements = rcall("ZREM", parentPrefix .. "waiting-children", parentId)
        if numRemovedElements == 1 then
          if hard then
            if parentPrefix == baseKey then
              removeParentDependencyKey(parentKey, hard, nil, baseKey)
              rcall("DEL", parentKey, parentKey .. ':logs',
                parentKey .. ':dependencies', parentKey .. ':processed')
            else
              moveParentToWait(parentPrefix, parentId)
            end
          else
            moveParentToWait(parentPrefix, parentId, true)
          end
        end
      end
    end
  else
    local missedParentKey = rcall("HGET", jobKey, "parentKey")
    if( (type(missedParentKey) == "string") and missedParentKey ~= "" and (rcall("EXISTS", missedParentKey) == 1)) then
      local parentProcessedKey = missedParentKey .. ":processed"
      rcall("HDEL", parentProcessedKey, jobKey)
      local parentDependenciesKey = missedParentKey .. ":dependencies"
      local result = rcall("SREM", parentDependenciesKey, jobKey)
      if result > 0 then
        local pendingDependencies = rcall("SCARD", parentDependenciesKey)
        if pendingDependencies == 0 then
          local parentId = getJobIdFromKey(missedParentKey)
          local parentPrefix = getJobKeyPrefix(missedParentKey, parentId)
          local numRemovedElements = rcall("ZREM", parentPrefix .. "waiting-children", parentId)
          if numRemovedElements == 1 then
            if hard then
              if parentPrefix == baseKey then
                removeParentDependencyKey(missedParentKey, hard, nil, baseKey)
                rcall("DEL", missedParentKey, missedParentKey .. ':logs',
                  missedParentKey .. ':dependencies', missedParentKey .. ':processed')
              else
                moveParentToWait(parentPrefix, parentId)
              end
            else
              moveParentToWait(parentPrefix, parentId, true)
            end
          end
        end
      end
    end
  end
end
local function removeJob(jobId, hard, baseKey)
  local jobKey = baseKey .. jobId
  removeParentDependencyKey(jobKey, hard, nil, baseKey)
  rcall("DEL", jobKey, jobKey .. ':logs',
    jobKey .. ':dependencies', jobKey .. ':processed')
end
--[[
  Functions to remove jobs by max age.
]]
-- Includes
local function removeJobsByMaxAge(timestamp, maxAge, targetSet, prefix)
  local start = timestamp - maxAge * 1000
  local jobIds = rcall("ZREVRANGEBYSCORE", targetSet, start, "-inf")
  for i, jobId in ipairs(jobIds) do
    removeJob(jobId, false, prefix)
  end
  rcall("ZREMRANGEBYSCORE", targetSet, "-inf", start)
end
--[[
  Functions to remove jobs by max count.
]]
-- Includes
local function removeJobsByMaxCount(maxCount, targetSet, prefix)
  local start = maxCount
  local jobIds = rcall("ZREVRANGE", targetSet, start, -1)
  for i, jobId in ipairs(jobIds) do
    removeJob(jobId, false, prefix)
  end
  rcall("ZREMRANGEBYRANK", targetSet, 0, -(maxCount + 1))
end
--[[
  Function to trim events, default 10000.
]]
local function trimEvents(metaKey, eventStreamKey)
  local maxEvents = rcall("HGET", metaKey, "opts.maxLenEvents")
  if maxEvents ~= false then
    rcall("XTRIM", eventStreamKey, "MAXLEN", "~", maxEvents)
  else
    rcall("XTRIM", eventStreamKey, "MAXLEN", "~", 10000)
  end
end
-- Check if we need to check for stalled jobs now.
local function checkStalledJobs(stalledKey, waitKey, activeKey, failedKey, stalledCheckKey,
    metaKey, pausedKey, eventStreamKey, maxStalledJobCount, queueKeyPrefix, timestamp, maxCheckTime)
    if rcall("EXISTS", stalledCheckKey) == 1 then 
        return {{}, {}}
    end
    rcall("SET", stalledCheckKey, timestamp, "PX", maxCheckTime)
    -- Trim events before emiting them to avoid trimming events emitted in this script
    trimEvents(metaKey, eventStreamKey)
    -- Move all stalled jobs to wait
    local stalling = rcall('SMEMBERS', stalledKey)
    local stalled = {}
    local failed = {}
    if (#stalling > 0) then
        rcall('DEL', stalledKey)
        local MAX_STALLED_JOB_COUNT = tonumber(maxStalledJobCount)
        -- Remove from active list
        for i, jobId in ipairs(stalling) do
            if jobId == '0' then
                -- If the jobId is a delay marker ID we just remove it.
                local removed = rcall("LREM", activeKey, 1, jobId)
            else
                local jobKey = queueKeyPrefix .. jobId
                -- Check that the lock is also missing, then we can handle this job as really stalled.
                if (rcall("EXISTS", jobKey .. ":lock") == 0) then
                    --  Remove from the active queue.
                    local removed = rcall("LREM", activeKey, 1, jobId)
                    if (removed > 0) then
                        -- If this job has been stalled too many times, such as if it crashes the worker, then fail it.
                        local stalledCount =
                            rcall("HINCRBY", jobKey, "stalledCounter", 1)
                        if (stalledCount > MAX_STALLED_JOB_COUNT) then
                            local rawOpts = rcall("HGET", jobKey, "opts")
                            local opts = cjson.decode(rawOpts)
                            local removeOnFailType = type(opts["removeOnFail"])
                            rcall("ZADD", failedKey, timestamp, jobId)
                            local failedReason =
                                "job stalled more than allowable limit"
                            rcall("HMSET", jobKey, "failedReason", failedReason,
                                "finishedOn", timestamp)
                            rcall("XADD", eventStreamKey, "*", "event", "failed", "jobId",
                                jobId, 'prev', 'active', 'failedReason',
                                failedReason)
                            if removeOnFailType == "number" then
                                removeJobsByMaxCount(opts["removeOnFail"], failedKey,
                                                    queueKeyPrefix)
                            elseif removeOnFailType == "boolean" then
                                if opts["removeOnFail"] then
                                    removeJob(jobId, false, queueKeyPrefix)
                                    rcall("ZREM", failedKey, jobId)
                                end
                            elseif removeOnFailType ~= "nil" then
                                local maxAge = opts["removeOnFail"]["age"]
                                local maxCount = opts["removeOnFail"]["count"]
                                if maxAge ~= nil then
                                    removeJobsByMaxAge(timestamp, maxAge, failedKey,
                                                    queueKeyPrefix)
                                end
                                if maxCount ~= nil and maxCount > 0 then
                                    removeJobsByMaxCount(maxCount, failedKey, queueKeyPrefix)
                                end
                            end
                            table.insert(failed, jobId)
                        else
                            local target = getTargetQueueList(metaKey, waitKey,
                                                            pausedKey)
                            -- Move the job back to the wait queue, to immediately be picked up by a waiting worker.
                            rcall("RPUSH", target, jobId)
                            rcall("XADD", eventStreamKey, "*", "event", "waiting", "jobId",
                                jobId, 'prev', 'active')
                            -- Emit the stalled event
                            rcall("XADD", eventStreamKey, "*", "event", "stalled", "jobId",
                                jobId)
                            table.insert(stalled, jobId)
                        end
                    end
                end
            end
        end
    end
    -- Mark potentially stalled jobs
    local active = rcall('LRANGE', activeKey, 0, -1)
    if (#active > 0) then
        for from, to in batches(#active, 7000) do
            rcall('SADD', stalledKey, unpack(active, from, to))
        end
    end
    return {failed, stalled}
end
return checkStalledJobs(KEYS[1], KEYS[2], KEYS[3], KEYS[4], KEYS[5], KEYS[6],
                        KEYS[7], KEYS[8], ARGV[1], ARGV[2], ARGV[3], ARGV[4])
`;
export const moveStalledJobsToWait = {
  name: 'moveStalledJobsToWait',
  content,
  keys: 8,
};
