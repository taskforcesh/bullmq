--[[
  Adds a job scheduler, i.e. a job factory that creates jobs based on a given schedule (repeat options).

  Supports two scheduling modes:
    1. "every" mode: Jobs run at fixed intervals (e.g., every 5000ms)
    2. "pattern" mode: Jobs run based on cron-like patterns

    Input:
      KEYS[1]  'repeat' key
      KEYS[2]  'delayed' key
      KEYS[3]  'wait' key
      KEYS[4]  'paused' key
      KEYS[5]  'meta' key
      KEYS[6]  'prioritized' key
      KEYS[7]  'marker' key
      KEYS[8]  'id' key
      KEYS[9]  'events' key
      KEYS[10] 'pc' priority counter
      KEYS[11] 'active' key
      
      ARGV[1] next milliseconds
      ARGV[2] msgpacked options
            [1]  name
            [2]  tz?
            [3]  pattern?
            [4]  endDate?
            [5]  every?
      ARGV[3] jobs scheduler id
      ARGV[4] Json stringified template data
      ARGV[5] mspacked template opts
      ARGV[6] msgpacked delayed opts
      ARGV[7] timestamp
      ARGV[8] prefix key
      ARGV[9] producer key

      Output:
        repeatableKey  - OK
        
      Error codes:
        -10: SchedulerJobIdCollision (pattern mode only)
        -11: SchedulerJobSlotsBusy (every mode only)
]]
local rcall = redis.call

-- Keys
local repeatKey = KEYS[1]
local delayedKey = KEYS[2]
local waitKey = KEYS[3]
local pausedKey = KEYS[4]
local metaKey = KEYS[5]
local prioritizedKey = KEYS[6]
local eventsKey = KEYS[9]

-- Arguments
local nextMillis = ARGV[1]
local jobSchedulerId = ARGV[3]
local templateData = ARGV[4]
local templateOpts = cmsgpack.unpack(ARGV[5])
local jobOpts = cmsgpack.unpack(ARGV[6])
local now = tonumber(ARGV[7])
local prefixKey = ARGV[8]
local producerKey = ARGV[9]

-- Includes
--- @include "includes/addJobFromScheduler"
--- @include "includes/getOrSetMaxEvents"
--- @include "includes/isQueuePaused"
--- @include "includes/removeJob"
--- @include "includes/storeJobScheduler"
--- @include "includes/getJobSchedulerEveryNextMillis"

-- =============================================================================
-- Helper Functions
-- =============================================================================

--[[
  Removes a job created by this scheduler from any queue state.
  Returns true if job was found and removed.
]]
local function removeJobFromScheduler(prefixKey, delayedKey, prioritizedKey, 
    waitKey, pausedKey, jobId, metaKey)
    -- Check delayed queue
    if rcall("ZSCORE", delayedKey, jobId) then
        removeJob(jobId, true, prefixKey, true)
        rcall("ZREM", delayedKey, jobId)
        return true
    end
    
    -- Check prioritized queue
    if rcall("ZSCORE", prioritizedKey, jobId) then
        removeJob(jobId, true, prefixKey, true)
        rcall("ZREM", prioritizedKey, jobId)
        return true
    end
    
    -- Check wait/paused queue
    local targetQueue = isQueuePaused(metaKey) and pausedKey or waitKey
    if rcall("LREM", targetQueue, 1, jobId) > 0 then
        removeJob(jobId, true, prefixKey, true)
        return true
    end

    return false
end

--[[
  Generates job ID and key based on scheduler ID and timestamp.
]]
local function generateJobIdentifiers(prefixKey, jobSchedulerId, millis)
    local jobId = "repeat:" .. jobSchedulerId .. ":" .. millis
    local jobKey = prefixKey .. jobId
    return jobId, jobKey
end

-- =============================================================================
-- Main Logic
-- =============================================================================

local schedulerKey = repeatKey .. ":" .. jobSchedulerId
local maxEvents = getOrSetMaxEvents(metaKey)
local schedulerOpts = cmsgpack.unpack(ARGV[2])

-- Determine scheduling mode
local every = schedulerOpts['every']
local isEveryMode = every ~= nil

-- Get previous scheduler state
local prevMillis = rcall("ZSCORE", repeatKey, jobSchedulerId)
if prevMillis then
    prevMillis = tonumber(prevMillis)
end

-- Get offset (for backwards compatibility, also check job opts)
local jobOffset = jobOpts['repeat'] and jobOpts['repeat']['offset'] or 0
local offset = schedulerOpts['offset'] or jobOffset or 0
local newOffset = offset

-- =============================================================================
-- Calculate Next Execution Time
-- =============================================================================

local everyValueChanged = false

if isEveryMode then
    -- "Every" mode: Calculate next millis based on interval
    local millis = prevMillis
    
    -- Check if 'every' value changed - if so, reset to recalculate
    if prevMillis then
        local prevEvery = tonumber(rcall("HGET", schedulerKey, "every"))
        if prevEvery ~= every then
            millis = nil
            everyValueChanged = true
        end
    end

    local startDate = schedulerOpts['startDate']
    nextMillis, newOffset = getJobSchedulerEveryNextMillis(millis, every, now, offset, startDate)
else
    -- "Pattern" mode: nextMillis is provided by ARGV[1] (calculated by JavaScript)
    nextMillis = tonumber(nextMillis)
end

-- =============================================================================
-- Handle Previous Job Removal
-- =============================================================================

local removedPrevJob = false

if prevMillis then
    local prevJobId = "repeat:" .. jobSchedulerId .. ":" .. prevMillis
    local prevJobKey = schedulerKey .. ":" .. prevMillis

    -- Remove previous job if it exists in a removable state
    if rcall("EXISTS", prevJobKey) == 1 then
        removedPrevJob = removeJobFromScheduler(
            prefixKey, delayedKey, prioritizedKey, 
            waitKey, pausedKey, prevJobId, metaKey
        )
    end
end

-- =============================================================================
-- Determine Final Execution Time and Handle Collisions
-- =============================================================================

if removedPrevJob then
    -- Previous job was removed - we can reuse the same time slot
    if isEveryMode and not everyValueChanged then
        nextMillis = prevMillis
    end
else
    -- No job was removed - store the new offset for future calculations
    schedulerOpts['offset'] = newOffset
end

-- Generate job identifiers for the target time slot
local jobId, jobKey = generateJobIdentifiers(prefixKey, jobSchedulerId, nextMillis)

-- Handle collision detection based on scheduling mode
local hasCollision = false

if rcall("EXISTS", jobKey) == 1 then
    if isEveryMode then
        -- "Every" mode: Try the next time slot
        local nextSlotMillis = nextMillis + every
        local nextSlotJobId, nextSlotJobKey = generateJobIdentifiers(
            prefixKey, jobSchedulerId, nextSlotMillis
        )

        if not rcall("EXISTS", nextSlotJobKey) == 1 then
            -- Next slot is available, use it
            nextMillis = nextSlotMillis
            jobId = nextSlotJobId
        else
            -- Both current and next slots are occupied
            return -11 -- SchedulerJobSlotsBusy
        end
    else
        -- "Pattern" mode: Cannot adjust time, mark as collision
        hasCollision = true
    end
end

-- =============================================================================
-- Create Job
-- =============================================================================

local delay = math.max(0, nextMillis - now)
local nextJobKey = schedulerKey .. ":" .. nextMillis

if not hasCollision or removedPrevJob then
    -- Store/update the scheduler
    storeJobScheduler(
        jobSchedulerId, schedulerKey, repeatKey, nextMillis,
        schedulerOpts, templateData, templateOpts
    )

    -- Increment job ID counter
    rcall("INCR", KEYS[8])

    -- Create the scheduled job
    addJobFromScheduler(
        nextJobKey, jobId, jobOpts, waitKey, pausedKey, KEYS[11],
        metaKey, prioritizedKey, KEYS[10], delayedKey, KEYS[7],
        eventsKey, schedulerOpts['name'], maxEvents, now,
        templateData, jobSchedulerId, delay
    )
elseif hasCollision then
    -- Pattern mode collision - cannot create job
    return -10 -- SchedulerJobIdCollision
end

-- =============================================================================
-- Update Producer Reference (if applicable)
-- =============================================================================

if producerKey ~= "" then
    rcall("HSET", producerKey, "nrjid", jobId)
end

return {jobId .. "", delay}
