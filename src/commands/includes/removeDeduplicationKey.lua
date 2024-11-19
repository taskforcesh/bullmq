--[[
  Function to remove deduplication key.
]]

local function removeDeduplicationKey(prefixKey, jobKey)
  local deduplicationId = rcall("HGET", jobKey, "deid")
  if deduplicationId then
    local deduplicationKey = prefixKey .. "de:" .. deduplicationId
    rcall("DEL", deduplicationKey)
  end
end
  