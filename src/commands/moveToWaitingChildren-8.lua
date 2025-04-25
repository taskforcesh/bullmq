--[[
  Moves job from active to waiting children set.

  Input:
    KEYS[1] active key
    KEYS[2] wait-children key
    KEYS[3] job key
    KEYS[4] job dependencies key
    KEYS[5] job unsuccessful key
    KEYS[6] stalled key
    KEYS[7] failed key
    KEYS[8] events key

    ARGV[1] token
    ARGV[2] child key
    ARGV[3] timestamp
    ARGV[4] jobId
    ARGV[5] prefix

  Output:
    0 - OK
    1 - There are not pending dependencies.
   -1 - Missing job.
   -2 - Missing lock
   -3 - Job not in active set
]]
local rcall = redis.call
local activeKey = KEYS[1]
local waitingChildrenKey = KEYS[2]
local jobKey = KEYS[3]
local jobDependenciesKey = KEYS[4]
local jobUnsuccessfulKey = KEYS[5]
local stalledKey = KEYS[6]
local failedKey = KEYS[7]
local timestamp = ARGV[3]
local jobId = ARGV[4]

--- Includes
--- @include "includes/moveChildFromDependenciesIfNeeded"
--- @include "includes/removeDeduplicationKeyIfNeededOnFinalization"
--- @include "includes/removeJobsOnFail"
--- @include "includes/removeLock"

local function moveToWaitingChildren(activeKey, waitingChildrenKey, jobId,
    timestamp)
  local score = tonumber(timestamp)

  local numRemovedElements = rcall("LREM", activeKey, -1, jobId)

  if(numRemovedElements < 1) then
    return -3
  end

  rcall("ZADD", waitingChildrenKey, score, jobId)

  return 0
end

if rcall("EXISTS", jobKey) == 1 then
  if rcall("ZCARD", jobUnsuccessfulKey) ~= 0 then
    -- TODO: refactor this logic in an include later
    local jobAttributes = rcall("HMGET", jobKey, "parent", "deid", "opts")

    removeDeduplicationKeyIfNeededOnFinalization(ARGV[5], jobAttributes[2], jobId)
  
    local failedReason = "children are failed"
    rcall("ZADD", failedKey, timestamp, jobId)
    rcall("HSET", jobKey, "finishedOn", timestamp)
    rcall("XADD", KEYS[8], "*", "event", "failed", "jobId", jobId, "failedReason",
      failedReason, "prev", "active")

    local rawParentData = jobAttributes[1]
    local rawOpts = jobAttributes[3]
    local opts = cjson.decode(rawOpts)

    moveChildFromDependenciesIfNeeded(rawParentData, jobKey, failedReason, timestamp)

    removeJobsOnFail(ARGV[5], failedKey, jobId, opts, timestamp)

    return 0
  else
    if ARGV[2] ~= "" then
      if rcall("SISMEMBER", jobDependenciesKey, ARGV[2]) ~= 0 then
        local errorCode = removeLock(jobKey, stalledKey, ARGV[1], jobId)
        if errorCode < 0 then
          return errorCode
        end
        return moveToWaitingChildren(activeKey, waitingChildrenKey, jobId, timestamp)
      end
  
      return 1
    else
      if rcall("SCARD", jobDependenciesKey) ~= 0 then 
        local errorCode = removeLock(jobKey, stalledKey, ARGV[1], jobId)
        if errorCode < 0 then
          return errorCode
        end
        return moveToWaitingChildren(activeKey, waitingChildrenKey, jobId, timestamp)
      end
  
      return 1
    end    
  end
end

return -1
