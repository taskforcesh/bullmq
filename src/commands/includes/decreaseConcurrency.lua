local function decreaseConcurrency(prefix, metaKey)
  local maxConcurrency = rcall("HGET", metaKey, "concurrency")
  if maxConcurrency then
    local activeCountKey = prefix .. 'active:count'
    local activeCount = rcall("GET", activeCountKey)
    if activeCount then
      local count
      if activeCount == 1 then
        rcall("DEL", activeCountKey)
        count = 0
      else
        count = rcall("DECR", activeCountKey)
      end

      if count < tonumber(maxConcurrency) then
        rcall("HDEL", metaKey, "maxed")
      end
    end
  end
end

