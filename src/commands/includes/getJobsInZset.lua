-- We use ZRANGEBYSCORE to make the case where we're deleting a limited number
-- of items in a sorted set only run a single iteration. If we simply used
-- ZRANGE, we may take a long time traversing through jobs that are within the
-- grace period.
local function getJobsInZset(zsetKey, rangeStart, rangeEnd, maxTimestamp, limit, useTimestampAsScore)
  local endRange
  if useTimestampAsScore then
    endRange = maxTimestamp
  else
    endRange = "+inf"
  end

  if limit > 0 then
    return rcall("ZRANGEBYSCORE", zsetKey, 0, endRange, "LIMIT", 0, limit)
  else
    return rcall("ZRANGEBYSCORE", zsetKey, 0, endRange)
  end
end
