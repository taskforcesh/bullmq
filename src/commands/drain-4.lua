--[[
  Drains the queue, removes all jobs that are waiting
  or delayed, but not active, completed or failed

  Input:
    KEYS[1] 'wait',
    KEYS[2] 'paused'
    KEYS[3] 'delayed'
    KEYS[4] 'priority'

    ARGV[1]  queue key prefix
]]
local rcall = redis.call
local queueBaseKey = ARGV[1]

local function removeJobs (list)
  for _, id in ipairs(list) do
    rcall("DEL", queueBaseKey .. id)
  end
end

local wait_ids = rcall("LRANGE", KEYS[1] , 0, -1)
local paused_ids = rcall("LRANGE", KEYS[2] , 0, -1)

removeJobs(wait_ids)
removeJobs(paused_ids)

if KEYS[3] ~= "" then
  local delayed_ids = rcall("ZRANGE", KEYS[3] , 0, -1)
  removeJobs(delayed_ids)
  rcall("DEL", KEYS[3])
end

rcall("DEL", KEYS[1])
rcall("DEL", KEYS[2])
rcall("DEL", KEYS[4])
