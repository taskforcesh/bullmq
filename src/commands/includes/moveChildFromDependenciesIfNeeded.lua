--[[
  Function to recursively move from waitingChildren to failed.
]]

-- Includes
--- @include "handleChildFailure"

local moveChildFromDependenciesIfNeeded = function (rawParentData, childKey, failedReason, timestamp)
  if rawParentData then
    local parentData = cjson.decode(rawParentData)
    if parentData['fpof'] or parentData['cpof'] or parentData['idof'] or parentData['rdof'] then
      local parentKey = parentData['queueKey'] .. ':' .. parentData['id']
      local parentDependenciesChildrenKey = parentKey .. ":dependencies"
      if rcall("SREM", parentDependenciesChildrenKey, childKey) == 1 then
        handleChildFailure(parentData, parentKey, childKey, failedReason, timestamp)
      end
    end
  end
end
