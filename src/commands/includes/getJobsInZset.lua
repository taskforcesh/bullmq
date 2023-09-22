-- We use ZRANGEBYSCORE to make the case where we're deleting a limited number
-- of items in a sorted set only run a single iteration. If we simply used
-- ZRANGE, we may take a long time traversing through jobs that are within the
-- grace period.
local function getJobsInZset(zsetKey, rangeEnd, limit)
  if limit > 0 then
    return rcall("ZRANGEBYSCORE", zsetKey, 0, rangeEnd, "LIMIT", 0, limit)
  else
    return rcall("ZRANGEBYSCORE", zsetKey, 0, rangeEnd)
  end
end
