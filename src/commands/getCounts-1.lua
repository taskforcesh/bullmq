--[[
  Get counts per provided states

    Input:
      KEYS[1]    'prefix'

      ARGV[1]    optional delayed timestamp cutoff (milliseconds)
      ARGV[...]  types (starts at 1 when no cutoff is provided)
]]
local rcall = redis.call;
local prefix = KEYS[1]
local results = {}
local delayedTimestamp = tonumber(ARGV[1])
local firstType = delayedTimestamp and 2 or 1

for i = firstType, #ARGV do
  local stateKey = prefix .. ARGV[i]
  if ARGV[i] == "wait" or ARGV[i] == "paused" then
    -- Markers in waitlist DEPRECATED in v5: Remove in v6.
    local marker = rcall("LINDEX", stateKey, -1)
    if marker and string.sub(marker, 1, 2) == "0:" then
      local count = rcall("LLEN", stateKey)
      if count > 1 then
        rcall("RPOP", stateKey)
        results[#results+1] = count-1
      else
        results[#results+1] = 0
      end
    else
      results[#results+1] = rcall("LLEN", stateKey)
    end
  elseif ARGV[i] == "active" then
    results[#results+1] = rcall("LLEN", stateKey)
  elseif ARGV[i] == "delayed" and delayedTimestamp then
    -- The low 12 score bits order jobs within a millisecond. Use a numeric
    -- bound below the cutoff, increasing the step if subtracting one rounds
    -- back to the same score. Safe-integer timestamps need at most 4096.
    local maxScore = delayedTimestamp * 4096.0
    local step = 1
    while maxScore - step == maxScore and step < 0x1000 do
      step = step * 2
    end
    results[#results+1] = rcall("ZCOUNT", stateKey, "-inf", maxScore - step)
  else
    results[#results+1] = rcall("ZCARD", stateKey)
  end
end

return results
