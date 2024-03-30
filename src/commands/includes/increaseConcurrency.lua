local function increaseConcurrency(prefix, metaKey)
  local maxConcurrency = rcall("HGET", metaKey, "concurrency")
  if maxConcurrency then
    local count = rcall("INCR", prefix .. 'active:count')

    if count >= tonumber(maxConcurrency) then
      rcall("HSET", metaKey, "maxed", 1)
      return true
    end
  end
  return false
end
