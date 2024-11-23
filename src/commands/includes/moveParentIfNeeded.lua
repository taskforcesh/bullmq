--[[
  Validate and move parent to active if needed.
]]

-- Includes
--- @include "moveParentFromWaitingChildrenToFailed"
--- @include "moveParentToWaitIfNeeded"

local function moveParentIfNeeded(parentData, parentKey, jobIdKey,
    failedReason, timestamp)
    if parentData['ocf'] then
        if parentData['ocf'] == 'f' then
            local grandParentData, parentFailedReason = moveParentFromWaitingChildrenToFailed(
                parentData['queueKey'],
                parentKey,
                parentData['id'],
                jobIdKey,
                timestamp)
            if grandParentData then
                moveParentIfNeeded(grandParentData, grandParentData['queueKey'] .. ':' .. grandParentData['id'],
                    parentKey, parentFailedReason, timestamp)
            end
        elseif parentData['ocf'] == 'i' or parentData['ocf'] == 'r' then
            local dependenciesSet = parentKey .. ":dependencies"
            if rcall("SREM", dependenciesSet, jobIdKey) == 1 then
                moveParentToWaitIfNeeded(parentData['queueKey'], dependenciesSet,
                                         parentKey, parentData['id'], timestamp)
                if parentData['ocf'] == 'i' then
                    local failedSet = parentKey .. ":failed"
                    rcall("HSET", failedSet, jobIdKey, failedReason)
                end
            end
        end    
    else
        if parentData['fpof'] then
            local grandParentData, parentFailedReason = moveParentFromWaitingChildrenToFailed(parentData['queueKey'],
                parentKey, parentData['id'], jobIdKey,
                timestamp)
            if grandParentData then
                moveParentIfNeeded(grandParentData, grandParentData['queueKey'] .. ':' .. grandParentData['id'],
                    parentKey, parentFailedReason, timestamp)
            end
        elseif parentData['idof'] or parentData['rdof'] then
            local dependenciesSet = parentKey .. ":dependencies"
            if rcall("SREM", dependenciesSet, jobIdKey) == 1 then
                moveParentToWaitIfNeeded(parentData['queueKey'], dependenciesSet,
                                         parentKey, parentData['id'], timestamp)
                if parentData['idof'] then
                    local failedSet = parentKey .. ":failed"
                    rcall("HSET", failedSet, jobIdKey, failedReason)
                end
            end
        else
            local grandParentData, parentFailedReason = moveParentFromWaitingChildrenToFailed(parentData['queueKey'],
                parentKey, parentData['id'], jobIdKey, timestamp)
            if grandParentData then
                moveParentIfNeeded(grandParentData, grandParentData['queueKey'] .. ':' .. grandParentData['id'],
                    parentKey, parentFailedReason, timestamp)
            end
        end    
    end
end
