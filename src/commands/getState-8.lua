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
    'prioritized'
    'waiting'
    'waiting-children'
    'unknown'
]]
local rcall = redis.call

if rcall("ZSCORE", KEYS[1], ARGV[1]) then
  return "completed"
end

if rcall("ZSCORE", KEYS[2], ARGV[1]) then
  return "failed"
end

if rcall("ZSCORE", KEYS[3], ARGV[1]) then
  return "delayed"
end

if rcall("ZSCORE", KEYS[8], ARGV[1]) then
  return "prioritized"
end

-- Includes
--- @include "includes/checkItemInList"

local active_items = rcall("LRANGE", KEYS[4] , 0, -1)
if checkItemInList(active_items, ARGV[1]) ~= nil then
  return "active"
end

local wait_items = rcall("LRANGE", KEYS[5] , 0, -1)
if checkItemInList(wait_items, ARGV[1]) ~= nil then
  return "waiting"
end

local paused_items = rcall("LRANGE", KEYS[6] , 0, -1)
if checkItemInList(paused_items, ARGV[1]) ~= nil then
  return "waiting"
end

if rcall("ZSCORE", KEYS[7], ARGV[1]) then
  return "waiting-children"
end

return "unknown"
