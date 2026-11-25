--[[
    This function is used to update the parent's dependencies if the job
    is already completed and about to be ignored. The parent must get its
    dependencies updated to avoid the parent job being stuck forever in 
    the waiting-children state.

    When "deferParentRelease" is true (flow inserts), the parent is *not*
    moved out of waiting-children here: the remaining children of the flow
    have not been inserted yet, so the parent would be released too early.
    Only the processed dependency is recorded; releasing the parent is
    validated by "releaseParentIfNoPendingDependencies" once the whole flow
    has been added.
]]

-- Includes
--- @include "updateParentDepsIfNeeded"

local function updateExistingJobsParent(parentKey, parent, parentData,
                                        parentDependenciesKey, completedKey,
                                        jobIdKey, jobId, timestamp,
                                        deferParentRelease)
    if parentKey ~= nil then
        if rcall("ZSCORE", completedKey, jobId) then
            local returnvalue = rcall("HGET", jobIdKey, "returnvalue")
            if deferParentRelease then
                rcall("HSET", parentKey .. ":processed", jobIdKey, returnvalue)
            else
                updateParentDepsIfNeeded(parentKey, parent['queueKey'],
                                         parentDependenciesKey, parent['id'],
                                         jobIdKey, returnvalue, timestamp)
            end
        else
            if parentDependenciesKey ~= nil then
                rcall("SADD", parentDependenciesKey, jobIdKey)
            end
        end
        rcall("HMSET", jobIdKey, "parentKey", parentKey, "parent", parentData)
    end
end
