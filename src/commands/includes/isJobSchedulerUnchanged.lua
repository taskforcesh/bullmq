--[[
  Function to check whether the scheduler stored under schedulerKey already
  holds exactly the definition we are about to write.

  Mirrors the fields storeJobScheduler persists. "offset" and "ic" are left out
  on purpose: both are carried over from the stored scheduler rather than
  supplied by the caller, so they never signal a changed definition.
]]
local function isJobSchedulerUnchanged(schedulerKey, opts, templateData, templateOpts)
  if rcall("EXISTS", schedulerKey) == 0 then
    return false
  end

  local storedValues = rcall("HGETALL", schedulerKey)
  local storedByField = {}
  for i = 1, #storedValues, 2 do
    storedByField[storedValues[i]] = storedValues[i + 1]
  end

  if storedByField["name"] ~= opts["name"] then
    return false
  end

  local comparedFields = {"tz", "limit", "pattern", "startDate", "endDate", "every"}
  for _, field in ipairs(comparedFields) do
    local declaredValue = opts[field]
    if declaredValue ~= nil then
      declaredValue = tostring(declaredValue)
    end

    if storedByField[field] ~= declaredValue then
      return false
    end
  end

  local declaredOpts = cjson.encode(templateOpts)
  if declaredOpts == '{}' then
    declaredOpts = nil
  end

  if storedByField["opts"] ~= declaredOpts then
    return false
  end

  local declaredData = templateData
  if declaredData == '{}' then
    declaredData = nil
  end

  return storedByField["data"] == declaredData
end
