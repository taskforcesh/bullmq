--[[
  Checks if job is in a given list.

  Input:
    KEYS[1] completed key

    ARGV[1] dependencies key

    Output:
      1  - if dependencies are ready.
      0 - if depenencies are not ready
]]

local dependencies = redis.call("SMEMBERS", ARGV[1])
if (#dependencies > 0) then
  for i, jobKey in ipairs(dependencies) do
    local _, _, _, _, jobId = string.find(jobKey, "(.*):(.*):(.*)")
    local isCompleted = redis.call("ZSCORE", KEYS[1] , jobId)

    if (isCompleted == false) then
      return 0
    end
  end
end

return 1