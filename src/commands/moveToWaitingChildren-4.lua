--[[
  Moves job from active to waiting children set.

  Input:
    KEYS[1] lock key
    KEYS[2] active key
    KEYS[3] waitChildrenKey key
    KEYS[4] job key

    ARGV[1] token
    ARGV[2] child key
    ARGV[3] timestamp
    ARGV[4] the id of the job
    ARGV[5] decrement attemptsMade

  Output:
    0 - OK
    1 - There are not pending dependencies.
   -1 - Missing job.
   -2 - Missing lock
   -3 - Job not in active set
]]
local rcall = redis.call

-- Includes
--- @include "includes/decrementAttemptsMade"

local function moveToWaitingChildren (activeKey, waitingChildrenKey, jobId, timestamp, lockKey, jobKey, token)
  if token ~= "0" then
    if rcall("GET", lockKey) == token then
      rcall("DEL", lockKey)
    else
      return -2
    end
  end

  local score = tonumber(timestamp)

  local numRemovedElements = rcall("LREM", activeKey, -1, jobId)

  if(numRemovedElements < 1) then
    return -3
  end

  rcall("ZADD", waitingChildrenKey, score, jobId)

  if ARGV[5] == "1" then
    decrementAttemptsMade(jobKey)
  end

  return 0
end

if rcall("EXISTS", KEYS[4]) == 1 then
  if ARGV[2] ~= "" then
    if rcall("SISMEMBER", KEYS[4] .. ":dependencies", ARGV[2]) ~= 0 then
      return moveToWaitingChildren(KEYS[2], KEYS[3], ARGV[4], ARGV[3], KEYS[1], KEYS[4], ARGV[1])
    end

    return 1
  else
    if rcall("SCARD", KEYS[4] .. ":dependencies") ~= 0 then 
      return moveToWaitingChildren(KEYS[2], KEYS[3], ARGV[4], ARGV[3], KEYS[1], KEYS[4], ARGV[1])
    end

    return 1
  end
end

return -1
