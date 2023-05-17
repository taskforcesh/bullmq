--[[
  Checks if a job is finished (.i.e. is in the completed or failed set)

  Input: 
    KEYS[1] completed key
    KEYS[2] failed key
    KEYS[3] job key

    ARGV[1] job id
    ARGV[2] return value?
  Output:
    0 - Not finished.
    1 - Completed.
    2 - Failed.
   -1 - Missing job. 
]]
local rcall = redis.call
if rcall("EXISTS", KEYS[3]) ~= 1 then
  if ARGV[2] == "1" then

    return {-1,"Missing key for job " .. KEYS[3] .. ". isFinished"}
  end  
  return -1
end

if rcall("ZSCORE", KEYS[1], ARGV[1]) ~= false then
  if ARGV[2] == "1" then
    local returnValue = rcall("HGET", KEYS[3], "returnvalue")

    return {1,returnValue}
  end
  return 1
end

if rcall("ZSCORE", KEYS[2], ARGV[1]) ~= false then
  if ARGV[2] == "1" then
    local failedReason = rcall("HGET", KEYS[3], "failedReason")

    return {2,failedReason}
  end
  return 2
end

if ARGV[2] == "1" then
  return {0}
end

return 0
