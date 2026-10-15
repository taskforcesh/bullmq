--[[
    This function is used to update the parent's dependencies if the job
    is already completed or failed and about to be ignored. The parent must
    get its dependencies updated to avoid the parent job being stuck forever
    in the waiting-children state.
]]

-- Includes
--- @include "handleChildFailure"
--- @include "updateParentDepsIfNeeded"

local function updateExistingJobsParent(parentKey, parent, parentData,
                                        parentDependenciesKey, completedKey,
                                        failedKey, jobIdKey, jobId, timestamp)
    if parentKey ~= nil then
        if rcall("ZSCORE", completedKey, jobId) then
            local returnvalue = rcall("HGET", jobIdKey, "returnvalue")
            updateParentDepsIfNeeded(parentKey, parent['queueKey'],
                                     parentDependenciesKey, parent['id'],
                                     jobIdKey, returnvalue, timestamp)
        elseif parentDependenciesKey ~= nil then
            if rcall("ZSCORE", failedKey, jobId) and
                (parent['fpof'] or parent['cpof'] or parent['idof'] or parent['rdof']) then
                -- A failed job is not re-run by a duplicated add, so resolve it
                -- the way its failure did instead of adding it to the
                -- dependencies. Drop a pending dependency an earlier add left.
                rcall("SREM", parentDependenciesKey, jobIdKey)
                local failedReason = rcall("HGET", jobIdKey, "failedReason")
                handleChildFailure(parent, parentKey, jobIdKey, failedReason,
                                   timestamp)
            else
                rcall("SADD", parentDependenciesKey, jobIdKey)
            end
        end
        rcall("HMSET", jobIdKey, "parentKey", parentKey, "parent", parentData)
    end
end
