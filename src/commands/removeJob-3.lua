--[[
    Remove a job from all the queues it may be in as well as all its data.
    In order to be able to remove a job, it cannot be active.

    Input:
      KEYS[1] queue prefix
      KEYS[2] meta key
      KEYS[3] repeat key

      ARGV[1] jobId
      ARGV[2] remove children

    Events:
      'removed'
]]
      
local rcall = redis.call

-- Includes
--- @include "includes/isJobSchedulerJob"
--- @include "includes/isLocked"
--- @include "includes/removeJobWithChildren"

local prefix = KEYS[1]
local jobId = ARGV[1]
local shouldRemoveChildren = ARGV[2]
local jobKey = prefix .. jobId
local repeatKey = KEYS[3]

if isJobSchedulerJob(jobId, jobKey, repeatKey) then
    return -8
end

if not isLocked(prefix, jobId, shouldRemoveChildren) then
    removeJobWithChildren(prefix, jobId, nil, shouldRemoveChildren)
    return 1
end
return 0
