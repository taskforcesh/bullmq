--[[
  Function to move a retried child back to its parent's dependencies, so the
  parent waits for it again.
]]

local function moveChildBackToParentDependencies(jobKey, prevState)
  local parentKey = rcall("HGET", jobKey, "parentKey")

  if parentKey and rcall("EXISTS", parentKey) == 1 then
    if prevState == "failed" then
      if rcall("ZREM", parentKey .. ":unsuccessful", jobKey) == 1 or
        rcall("HDEL", parentKey .. ":failed", jobKey) == 1 then
        rcall("SADD", parentKey .. ":dependencies", jobKey)
      end
    else
      if rcall("HDEL", parentKey .. ":processed", jobKey) == 1 then
        rcall("SADD", parentKey .. ":dependencies", jobKey)
      end
    end
  end
end
