--[[
  Moves job from active to waiting children set.

  Input:
    KEYS[1] lock key
    KEYS[2] active key
    KEYS[3] waitChildrenKey key
    KEYS[4] job key
    KEYS[5] stalled key

    ARGV[1] token
    ARGV[2] child key
    ARGV[3] timestamp
    ARGV[4] the id of the job

  Output:
    0 - OK
    1 - There are not pending dependencies.
   -1 - Missing job.
   -2 - Missing lock
   -3 - Job not in active set
]]
local rcall = redis.call
local stalledKey = KEYS[5]

--- Includes
--- @include "includes/removeLock"

local function moveToWaitingChildren (activeKey, waitingChildrenKey, jobId,
    timestamp)
  local score = tonumber(timestamp)

  local numRemovedElements = rcall("LREM", activeKey, -1, jobId)

  if(numRemovedElements < 1) then
    return -3
  end

  rcall("ZADD", waitingChildrenKey, score, jobId)

  return 0
end

if rcall("EXISTS", KEYS[4]) == 1 then
  if ARGV[2] ~= "" then
    if rcall("SISMEMBER", KEYS[4] .. ":dependencies", ARGV[2]) ~= 0 then
      local errorCode = removeLock(KEYS[4], stalledKey, ARGV[1], ARGV[4])
      if errorCode < 0 then
        return errorCode
      end
      return moveToWaitingChildren(KEYS[2], KEYS[3], ARGV[4], ARGV[3])
    end

    return 1
  else
    if rcall("SCARD", KEYS[4] .. ":dependencies") ~= 0 then 
      local errorCode = removeLock(KEYS[4], stalledKey, ARGV[1], ARGV[4])
      if errorCode < 0 then
        return errorCode
      end
      return moveToWaitingChildren(KEYS[2], KEYS[3], ARGV[4], ARGV[3])
    end

    return 1
  end
end

return -1
