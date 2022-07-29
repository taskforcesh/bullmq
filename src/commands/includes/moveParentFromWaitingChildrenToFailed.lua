--[[
  Function to recursively moves from waitingChildren to failed.
]]

local function moveParentFromWaitingChildrenToFailed( parentQueueKey, parentKey, parentId, jobId, timestamp)
  if rcall("ZREM", parentQueueKey .. ":waiting-children", jobId) == 1 then
    rcall("ZADD", parentQueueKey .. ":failed", timestamp, parentId)
    rcall("HMSET", parentKey, "failedReason", "child " .. jobId .. " failed", "finishedOn", timestamp)

    local rawParentData = rcall("HGET", parentKey, "parent")

    if rawParentData ~= nil then
      local parentData = cjson.decode(rawParentData)
      if parentData['fpof'] then
        moveParentFromWaitingChildrenToFailed(
          parentData['queueKey'],
          parentData['queueKey'] .. ':' .. parentData['id'],
          parentData['id'],
          parentId,
          timestamp
        )
      end
    end
  end
end
