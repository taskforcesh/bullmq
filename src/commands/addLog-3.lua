--[[
  Update job progress

  Input:
    KEYS[1] job id key
    KEYS[3] job logs key

    ARGV[1] id
    ARGV[2] log
    ARGV[3] keepLogs

  Output:
     0 - OK
    -1 - Missing job.
]]
local rcall = redis.call

if rcall("EXISTS", KEYS[1]) == 1 then -- // Make sure job exists
  local logCount = rcall("RPUSH", KEYS[2], ARGV[2])

  if ARGV[3] ~= nil then
    local keepLogs = tonumber(ARGV[3])
    rcall("LTRIM", KEYS[2], -keepLogs, -1)

    return math.min(keepLogs, logCount)
  end

  return logCount
else
  return -1
end
