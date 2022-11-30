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

--- @include "includes/removeJobs"

removeListJobs(KEYS[1], true, queueBaseKey, 0) --wait
removeListJobs(KEYS[2], true, queueBaseKey, 0) --paused

if KEYS[3] ~= "" then
  removeZSetJobs(KEYS[3], true, queueBaseKey, 0) --delayed
end

rcall("DEL", KEYS[4])
