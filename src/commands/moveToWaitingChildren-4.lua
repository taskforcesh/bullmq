--[[
  Moves job from active to waiting children set.

  Input:
    KEYS[1] lock key
    KEYS[2] active key
    KEYS[3] waitChildrenKey key
    KEYS[4] job key

    ARGV[1] token
    ARGV[2] timestamp
    ARGV[3] the id of the job
    
  Output:
    0 - OK
    1 - There are not pending dependencies.
   -1 - Missing job.
   -2 - Missing lock
]]
local rcall = redis.call

if ARGV[1] ~= "0" then
  if rcall("GET", KEYS[1]) ~= ARGV[1] then
      return -2
  end
end

if rcall("EXISTS", KEYS[4]) == 1 then
  if rcall("SCARD", KEYS[4] .. ":dependencies") ~= 0 then 
    local jobId = ARGV[3]
    local score = tonumber(ARGV[2])
  
    rcall("ZADD", KEYS[3], score, jobId)
    rcall("LREM", KEYS[2], 0, jobId)
  
    return 0
  end
  
  return 1    
end

return -1