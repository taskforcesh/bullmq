--[[
  Iterative variant of isLocked. Walks the dependency tree using an
  explicit stack instead of recursion so that deep flow hierarchies do
  not hit Lua's call-depth limits (see #2431).

  Returns true as soon as any visited job is locked, otherwise false.
  When removeChildren is not "1", behaves exactly like the single-job
  lock check.
]]
--- @include "destructureJobKey"

local function isLockedIter(prefix, jobId, removeChildren)
  local stack = { { prefix, jobId } }

  while #stack > 0 do
    local entry = stack[#stack]
    stack[#stack] = nil

    local entryPrefix = entry[1]
    local entryJobId = entry[2]
    local jobKey = entryPrefix .. entryJobId

    if rcall("GET", jobKey .. ':lock') then
      return true
    end

    if removeChildren == "1" then
      local dependencies = rcall("SMEMBERS", jobKey .. ":dependencies")
      if #dependencies > 0 then
        for i = #dependencies, 1, -1 do
          local childJobKey = dependencies[i]
          local childJobId = getJobIdFromKey(childJobKey)
          local childJobPrefix = getJobKeyPrefix(childJobKey, childJobId)
          stack[#stack + 1] = { childJobPrefix, childJobId }
        end
      end
    end
  end

  return false
end
