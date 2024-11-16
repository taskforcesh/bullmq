--[[
  Function to remove deduplication key if needed.
]]

local function removeDeduplicationKeyIfNeeded(prefixKey, deduplicationId)
  if deduplicationId then
    local deduplicationKey = prefixKey .. "de:" .. deduplicationId
    local pttl = rcall("PTTL", deduplicationKey)

    if pttl == 0 or pttl == -1 then
      rcall("DEL", deduplicationKey)
    end
  end
end
