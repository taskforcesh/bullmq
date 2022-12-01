--[[
  Promotes a job that is currently "delayed" to the "waiting" state

    Input:
      KEYS[1]    'prefix'

      ARGV[1]    start
      ARGV[2]    end
      ARGV[3]    asc
      ARGV[4...] types
]]
local rcall = redis.call;
local prefix = KEYS[1]
local rangeStart = tonumber(ARGV[1])
local rangeEnd = tonumber(ARGV[2])
local asc = ARGV[3]
local results = {}

for i = 4, #ARGV do
  local stateKey = prefix .. ARGV[i]
  if ARGV[i] == "wait" or ARGV[i] == "paused" then
    local marker = rcall("LINDEX", stateKey, -1)
    if marker and string.sub(marker, 1, 2) == "0:" then
      local count = rcall("LLEN", stateKey)
      if count > 0 then
        rcall("RPOP", stateKey)
      end
    end
    if asc == "1" then
      if rangeEnd == -1 then
        rangeEnd = 0
      else
        rangeEnd = -(rangeEnd + 1)
      end

      if rangeEnd == -1 then
        rangeEnd = 0
      else
        rangeEnd = -(rangeEnd + 1)
      end

      results[#results+1] = rcall("LRANGE", stateKey,
        rangeEnd,
        rangeStart)
    else
      results[#results+1] = rcall("LRANGE", stateKey, rangeStart, rangeEnd)
    end
  elseif ARGV[i] == "active" then
    if asc == "1" then
      if rangeEnd == -1 then
        rangeEnd = 0
      else
        rangeEnd = -(rangeEnd + 1)
      end

      if rangeEnd == -1 then
        rangeEnd = 0
      else
        rangeEnd = -(rangeEnd + 1)
      end
      results[#results+1] = rcall("LRANGE", stateKey, rangeEnd, rangeStart)
    else
      results[#results+1] = rcall("LRANGE", stateKey, rangeStart, rangeEnd)
    end
  else
    if asc == "1" then
      results[#results+1] = rcall("ZRANGE", stateKey, rangeStart, rangeEnd)
    else
      results[#results+1] = rcall("ZREVRANGE", stateKey, rangeStart, rangeEnd)
    end
  end
end

return results
