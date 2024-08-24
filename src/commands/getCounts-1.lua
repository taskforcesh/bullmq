--[[
  Get counts per provided states

    Input:
      KEYS[1]    'prefix'

      ARGV[1...] types
]]
local rcall = redis.call;
local prefix = KEYS[1]
local results = {}

for i = 1, #ARGV do
  local stateKey = prefix .. ARGV[i]
  if ARGV[i] == "wait" or ARGV[i] == "paused" or ARGV[i] == "active" then
    results[#results+1] = rcall("LLEN", stateKey)
  else
    results[#results+1] = rcall("ZCARD", stateKey)
  end
end

return results
