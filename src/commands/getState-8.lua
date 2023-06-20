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
    KEYS[8] 'priority' key

    ARGV[1] job id
    ARGV[2] job key
  Output:
    'completed'
    'failed'
    'delayed'
    'active'
    'priority'
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

local pprefix = rcall("HGET", ARGV[2], "pp")
if pprefix and rcall("ZSCORE", KEYS[8], pprefix .. ":" .. ARGV[1]) ~= false then
  return "priority"
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

if rcall("ZSCORE", KEYS[7], ARGV[1]) ~= false then
  return "waiting-children"
end

return "unknown"
