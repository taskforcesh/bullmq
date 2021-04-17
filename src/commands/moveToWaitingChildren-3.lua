--[[
  Moves job from active to waiting children set.

  Input: 
    KEYS[1] active key
    KEYS[2] waitChildrenKey key
    KEYS[3] job key

    ARGV[1] the id of the job
    ARGV[2] timestamp
    
  Output:
    0 - OK
    1 - There are not pending dependencies.
   -1 - Missing job.
]]
local rcall = redis.call

if rcall("EXISTS", KEYS[3]) == 1 then
  if rcall("SCARD", KEYS[3] .. ":dependencies") ~= 0 then 
    local jobId = ARGV[2]
    local score = tonumber(ARGV[1])

    rcall("ZADD", KEYS[2], score, jobId)
    rcall("LREM", KEYS[1], 0, jobId)

    return 0
  end

  return 1
else
  return -1
end
