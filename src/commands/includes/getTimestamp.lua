--[[
  Function to get the latest saved timestamp.
]]

local function getTimestamp(jobKey, attributes)
  if #attributes == 1 then
    return rcall("HGET", jobKey, attributes[1])
  end

  local jobTs
  for _, ts in ipairs(rcall("HMGET", jobKey, unpack(attributes))) do
    rcall("SET", "DEBUG1", type(ts))
    if (ts) then
      rcall("SET", "DEBUG2", ts)
      jobTs = ts
      break
    end
  end

  return jobTs
end
