--[[
  Change job priority
  Input:
    KEYS[1] 'wait',
    KEYS[2] 'meta'
    KEYS[3] 'prioritized'
    KEYS[4] 'active'
    KEYS[5] 'pc' priority counter
    KEYS[6] 'marker'

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
--- @include "includes/isQueuePausedOrMaxed"
--- @include "includes/pushBackJobWithPriority"

local function reAddJobWithNewPriority( prioritizedKey, markerKey, waitKey,
    priorityCounter, lifo, priority, jobId, isPausedOrMaxed)
    if priority == 0 then
        local pushCmd = lifo and 'RPUSH' or 'LPUSH'
        addJobInTargetList(waitKey, markerKey, pushCmd, isPausedOrMaxed, jobId)
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
    local metaKey = KEYS[2]
    local isPausedOrMaxed = isQueuePausedOrMaxed(metaKey, KEYS[4])
    local prioritizedKey = KEYS[3]
    local priorityCounterKey = KEYS[5]
    local markerKey = KEYS[6]
    
    -- Re-add with the new priority
    if rcall("ZREM", prioritizedKey, jobId) > 0 then
        reAddJobWithNewPriority( prioritizedKey, markerKey, KEYS[1],
            priorityCounterKey, ARGV[4] == '1', priority, jobId, isPausedOrMaxed)
    elseif rcall("LREM", KEYS[1], -1, jobId) > 0 then
        reAddJobWithNewPriority( prioritizedKey, markerKey, KEYS[1],
            priorityCounterKey, ARGV[4] == '1', priority, jobId, isPausedOrMaxed)
    end

    rcall("HSET", jobKey, "priority", priority)

    return 0
else
    return -1
end
