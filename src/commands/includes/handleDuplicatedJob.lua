--[[
  Function to handle the case when job is duplicated.
]]

-- Includes
--- @include "updateExistingJobsParent"

local function handleDuplicatedJob(jobKey, jobId, currentParentKey, currentParent,
  parentData, parentDependenciesKey, completedKey, eventsKey, maxEvents, timestamp,
  deferParentRelease)
  local existedParentKey = rcall("HGET", jobKey, "parentKey")

  if not existedParentKey or existedParentKey == currentParentKey
     or rcall("EXISTS", existedParentKey) == 0 then
    updateExistingJobsParent(currentParentKey, currentParent, parentData,
      parentDependenciesKey, completedKey, jobKey,
      jobId, timestamp, deferParentRelease)
  else
    if currentParentKey ~= nil and currentParentKey ~= existedParentKey
      and (rcall("EXISTS", existedParentKey) == 1) then
      if deferParentRelease then
        rcall("HSET", currentParentKey, "flowAttachmentFailed", "1")
      end
      return -7
    end
  end
  rcall("XADD", eventsKey, "MAXLEN", "~", maxEvents, "*", "event",
    "duplicated", "jobId", jobId)

  return jobId .. "" -- convert to string
end
