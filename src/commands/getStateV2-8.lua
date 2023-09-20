--[[
  Get a job state

  Input: 
    KEYS[1] 'completed' key,
    KEYS[2] 'failed' key
    KEYS[3] 'delayed' key
    KEYS[4] 'active' key
    KEYS[5] 'wait' key
    KEYS[6] 'paused' key
    KEYS[7] 'waiting-children' key
    KEYS[8] 'prioritized' key

    ARGV[1] job id
  Output:
    'completed'
    'failed'
    'delayed'
    'active'
    'waiting'
    'waiting-children'
    'unknown'
]]
local rcall = redis.call

if rcall("ZSCORE", KEYS[1], ARGV[1]) ~= false then
  return "completed"
end

if rcall("ZSCORE", KEYS[2], ARGV[1]) ~= false then
  return "failed"
end

if rcall("ZSCORE", KEYS[3], ARGV[1]) ~= false then
  return "delayed"
end

if rcall("ZSCORE", KEYS[8], ARGV[1]) ~= false then
  return "prioritized"
end

if rcall("LPOS", KEYS[4] , ARGV[1]) ~= false then
  return "active"
end

if rcall("LPOS", KEYS[5] , ARGV[1]) ~= false then
  return "waiting"
end

if rcall("LPOS", KEYS[6] , ARGV[1]) ~= false then
  return "waiting"
end

if rcall("ZSCORE", KEYS[7] , ARGV[1]) ~= false then
  return "waiting-children"
end

return "unknown"
