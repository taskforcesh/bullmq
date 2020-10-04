--[[
  Get Jobs by ID pattern

     Input:
        KEYS[1] Queue / Name Set Key
        ARGV[1] Key Prefix
        ARGV[2] cursor
        ARGV[3] count
]]
local scanResult = redis.call("SSCAN", KEYS[1], ARGV[2], "COUNT", ARGV[3])

local newCursor = scanResult[1]
local scannedJobIds = scanResult[2]

local result = { newCursor }

for index, jobId in pairs(scannedJobIds) do
  table.insert(result, "id")
  table.insert(result, jobId)

  local jobIdKey = ARGV[1] .. jobId

  local jobHash = redis.call("HGETALL", jobIdKey)

  for key, value in pairs(jobHash) do
    table.insert(result, value)
  end
end

return result
