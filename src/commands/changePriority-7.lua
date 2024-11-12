--[[
  Change job priority
  Input:
    KEYS[1] 'wait',
    KEYS[2] 'paused'
    KEYS[3] 'meta'
    KEYS[4] 'prioritized'
    KEYS[5] 'active'
    KEYS[6] 'pc' priority counter
    KEYS[7] 'marker'

    ARGV[1] priority value
    ARGV[2] prefix key
    ARGV[3] job id
    ARGV[4] lifo

    Output:
       0  - OK
      -1  - Missing job
]]
local jobId = ARGV[3]
local jobKey = ARGV[2] .. jobId
local priority = tonumber(ARGV[1])
local rcall = redis.call

-- Includes
--- @include "includes/addJobInTargetList"
--- @include "includes/addJobWithPriority"
--- @include "includes/getTargetQueueList"
--- @include "includes/pushBackJobWithPriority"

local function reAddJobWithNewPriority( prioritizedKey, markerKey, targetKey,
    priorityCounter, lifo, priority, jobId, isPausedOrMaxed)
    if priority == 0 then
        local pushCmd = lifo and 'RPUSH' or 'LPUSH'
        addJobInTargetList(targetKey, markerKey, pushCmd, isPausedOrMaxed, jobId)
    else
        if lifo then
            pushBackJobWithPriority(prioritizedKey, priority, jobId)
        else
            addJobWithPriority(markerKey, prioritizedKey, priority, jobId,
                priorityCounter, isPausedOrMaxed)
        end
    end
end

if rcall("EXISTS", jobKey) == 1 then
    local metaKey = KEYS[3]
    local target, isPausedOrMaxed = getTargetQueueList(metaKey, KEYS[5], KEYS[1], KEYS[2])
    local prioritizedKey = KEYS[4]
    local priorityCounterKey = KEYS[6]
    local markerKey = KEYS[7]
    
    -- Re-add with the new priority
    if rcall("ZREM", prioritizedKey, jobId) > 0 then
        reAddJobWithNewPriority( prioritizedKey, markerKey, target,
            priorityCounterKey, ARGV[4] == '1', priority, jobId, isPausedOrMaxed)
    elseif rcall("LREM", target, -1, jobId) > 0 then
        reAddJobWithNewPriority( prioritizedKey, markerKey, target,
            priorityCounterKey, ARGV[4] == '1', priority, jobId, isPausedOrMaxed)
    end

    rcall("HSET", jobKey, "priority", priority)

    return 0
else
    return -1
end
