--[[
  Drains the queue, removes all jobs that are waiting
  or delayed, but not active, completed or failed

  Input:
    KEYS[1] 'wait',
    KEYS[2] 'paused'
    KEYS[3] 'delayed'
    KEYS[4] 'priority'

    ARGV[1]  queue key prefix,
]]
local rcall = redis.call

local function delete_item (list, queuePrefix)
  for _, v in ipairs(list) do
    rcall("DEL", queuePrefix .. v)
  end
end

local wait_ids = rcall("LRANGE", KEYS[1] , 0, -1)
local paused_ids = rcall("LRANGE", KEYS[2] , 0, -1)

delete_item(wait_ids, ARGV[1])
delete_item(paused_ids, ARGV[1])

if KEYS[3] ~= "" then
  local delayed_ids = rcall("ZRANGE", KEYS[3] , 0, -1)
  delete_item(delayed_ids, ARGV[1])
  rcall("DEL", KEYS[3])
end

rcall("DEL", KEYS[1])
rcall("DEL", KEYS[2])
rcall("DEL", KEYS[4])
