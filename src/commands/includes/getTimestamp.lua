--[[
  Function to get the latest saved timestamp.
]]

local function getTimestamp(jobKey, attributes)
  if #attributes == 1 then
    return rcall("HGET", jobKey, attributes[1])
  end

  local jobTs
  for _, ts in ipairs(rcall("HMGET", jobKey, unpack(attributes))) do
    if (ts) then
      jobTs = ts
      break
    end
  end
  
  return jobTs
end
