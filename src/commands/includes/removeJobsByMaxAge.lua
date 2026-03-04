--[[
  Functions to remove jobs by max age.
]]

-- Includes
--- @include "batches"
--- @include "removeJob"

local function removeJobsByMaxAge(timestamp, maxAge, targetSet, prefix, maxLimit)
  local start = timestamp - maxAge * 1000
  local jobIds = rcall("ZREVRANGEBYSCORE", targetSet, start, "-inf", "LIMIT", 0, maxLimit)
  for i, jobId in ipairs(jobIds) do
    removeJob(jobId, false, prefix, false --[[remove debounce key]])
  end
  for from, to in batches(#jobIds, 7000) do
    rcall("ZREM", targetSet, unpack(jobIds, from, to))
  end
end
