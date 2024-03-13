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
--- @include "includes/isQueuePaused"
--- @include "includes/addJobWithPriority"

if rcall("EXISTS", jobKey) == 1 then
    local metaKey = KEYS[3]
    local isPaused = isQueuePaused(metaKey)
    local markerKey = KEYS[6]
    local prioritizedKey = KEYS[4]

    -- Re-add with the new priority
    if rcall("ZREM", KEYS[4], jobId) > 0 then
        addJobWithPriority(markerKey, prioritizedKey, priority, jobId, KEYS[5],
                           isPaused)
        -- If the new priority is 0, then just leave the job where it is in the wait list.
    elseif priority > 0 then
        -- Job is already in the wait list, we need to re-add it with the new priority.
        local target = isPaused and KEYS[2] or KEYS[1]

        local numRemovedElements = rcall("LREM", target, -1, jobId)
        if numRemovedElements > 0 then
            addJobWithPriority(markerKey, prioritizedKey, priority, jobId,
                               KEYS[5], isPaused)
        end
    end

    rcall("HSET", jobKey, "priority", priority)

    return 0
else
    return -1
end
