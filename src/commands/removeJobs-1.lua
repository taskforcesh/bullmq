--[[
    Remove several jobs at once, each from all the statuses it may be in as well
    as all its data. The whole operation runs atomically.

    Jobs that do not exist, that are locked by a worker (or, when removing
    children, have a locked child) or that are the current iteration of a job
    scheduler are skipped instead of aborting the whole operation.

    Input:
      KEYS[1] repeat key

      ARGV[1] queue prefix
      ARGV[2] remove children
      ARGV[3...] job ids

    Output:
      Array with the ids of the jobs that were removed.

    Events:
      'removed'
]]

local rcall = redis.call

-- Includes
--- @include "includes/isJobSchedulerJob"
--- @include "includes/isLocked"
--- @include "includes/removeJobWithChildren"

local repeatKey = KEYS[1]
local prefix = ARGV[1]
local shouldRemoveChildren = ARGV[2]

local options = {
    removeChildren = shouldRemoveChildren == "1",
    ignoreProcessed = false,
    ignoreLocked = false
}

local removed = {}

for i = 3, #ARGV do
    local jobId = ARGV[i]
    local jobKey = prefix .. jobId

    if rcall("EXISTS", jobKey) == 1
        and not isJobSchedulerJob(jobId, jobKey, repeatKey)
        and not isLocked(prefix, jobId, shouldRemoveChildren) then
        removeJobWithChildren(prefix, jobId, nil, options)
        removed[#removed + 1] = jobId
    end
end

return removed
