--[[
  Get Jobs by ID pattern

     Input:
        ARGV[1] ID pattern
        ARGV[2] cursor
        ARGV[3] count
]]
local scanResult = redis.call("SCAN", ARGV[2], "COUNT", ARGV[3], "MATCH", ARGV[1], "TYPE", "hash")

local newCursor = scanResult[1]
local scannedJobIds = scanResult[2]

local result = { newCursor }

for index, jobIdKey in pairs(scannedJobIds) do
  table.insert(result, "jobIdKey")
  table.insert(result, jobIdKey)

  local jobHash = redis.call("HGETALL", jobIdKey)

  for key, value in pairs(jobHash) do
    table.insert(result, value)
  end
end

return result
