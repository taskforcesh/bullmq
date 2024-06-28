--[[
  Change job priority
  Input:
    KEYS[1] 'wait',
    KEYS[2] 'paused'
    KEYS[3] 'meta'
    KEYS[4] 'prioritized'
    KEYS[5] 'pc' priority counter
    KEYS[6] 'marker'

    ARGV[1] priority value
    ARGV[2] job key
    ARGV[3] job id
    ARGV[4] lifo

    Output:
       0  - OK
      -1  - Missing job
]]
local jobKey = ARGV[2]
local jobId = ARGV[3]
local priority = tonumber(ARGV[1])
local rcall = redis.call

-- Includes
--- @include "includes/addJobInTargetList"
--- @include "includes/addJobWithPriority"
--- @include "includes/getTargetQueueList"
--- @include "includes/pushBackJobWithPriority"

local function reAddJobWithNewPriority( prioritizedKey, markerKey, targetKey,
    priorityCounter, lifo, priority, jobId, paused)
    if priority == 0 then
        local pushCmd = lifo and 'RPUSH' or 'LPUSH'
        addJobInTargetList(targetKey, markerKey, pushCmd, paused, jobId)
    else
        if lifo then
            pushBackJobWithPriority(prioritizedKey, priority, jobId)
        else
            addJobWithPriority(markerKey, prioritizedKey, priority, jobId,
                priorityCounter, paused)
        end
    end
end

if rcall("EXISTS", jobKey) == 1 then
    local metaKey = KEYS[3]
    local target, isPaused = getTargetQueueList(metaKey, KEYS[1], KEYS[2])
    local markerKey = KEYS[6]
    local prioritizedKey = KEYS[4]

    -- Re-add with the new priority
    if rcall("ZREM", KEYS[4], jobId) > 0 then
        reAddJobWithNewPriority( prioritizedKey, markerKey, target,
            KEYS[5], ARGV[4] == '1', priority, jobId, isPaused)
    elseif rcall("LREM", target, -1, jobId) > 0 then
        reAddJobWithNewPriority( prioritizedKey, markerKey, target,
            KEYS[5], ARGV[4] == '1', priority, jobId, isPaused)
    end

    rcall("HSET", jobKey, "priority", priority)

    return 0
else
    return -1
end
