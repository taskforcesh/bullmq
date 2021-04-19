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
    
  Output:
    0 - OK
    1 - There are not pending dependencies.
   -1 - Missing job.
   -2 - Missing lock
]]
local rcall = redis.call

local function move_to_waiting_children (activeKey, waitingChildrenKey, jobId, timestamp)
  local score = tonumber(timestamp)
  
  rcall("ZADD", waitingChildrenKey, score, jobId)
  rcall("LREM", activeKey, 0, jobId)
end

if ARGV[1] ~= "0" then
  if rcall("GET", KEYS[1]) ~= ARGV[1] then
      return -2
  end
end

if rcall("EXISTS", KEYS[4]) == 1 then
  if ARGV[2] ~= "" then
    if rcall("SISMEMBER", KEYS[4] .. ":dependencies", ARGV[2]) ~= 0 then
      move_to_waiting_children(KEYS[2], KEYS[3], ARGV[4], ARGV[3])
  
      return 0
    end

    return 1
  else
    if rcall("SCARD", KEYS[4] .. ":dependencies") ~= 0 then 
      move_to_waiting_children(KEYS[2], KEYS[3], ARGV[4], ARGV[3])
  
      return 0
    end

    return 1
  end
end

return -1