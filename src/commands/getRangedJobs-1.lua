--[[
  Atomically range over the provided state lists/sets and fetch the raw job
  hashes in a single round-trip.

  Performing the range and the HGETALL for each returned job id inside the
  same Lua script guarantees that jobs cannot be auto-removed between the
  range operation and the subsequent fetch. This preserves the requested
  pagination range even when queues are being actively cleaned.

  Range size is bounded by the TS-side wrapper (Scripts.getRangedJobs),
  which splits large requests into batches of at most
  Scripts.MAX_RANGED_JOBS jobs per invocation. This script trusts the
  caller-supplied range and does not perform additional truncation.

    Input:
      KEYS[1]    'prefix'

      ARGV[1]    start
      ARGV[2]    end
      ARGV[3]    asc ("1" for ascending, "0" otherwise)
      ARGV[4...] types

    Output:
      For each provided type, two entries are appended to the result:
        - an array of job ids, in range order
        - an array of raw job hashes (flat arrays returned by HGETALL), in
          the same order as the ids. Because the script runs atomically,
          a hash returned for an id in the range is guaranteed to exist
          (no concurrent removal can race the HGETALL).
]]
local rcall = redis.call
local prefix = KEYS[1]
local rangeStart = tonumber(ARGV[1])
local rangeEnd = tonumber(ARGV[2])
local asc = ARGV[3]
local results = {}

local function fetchJobs(ids)
  local jobs = {}
  for i = 1, #ids do
    jobs[i] = rcall("HGETALL", prefix .. ids[i])
  end
  return jobs
end

local function getRangeInList(listKey, asc, rangeStart, rangeEnd)
  if asc == "1" then
    local modifiedRangeStart
    local modifiedRangeEnd
    if rangeStart == -1 then
      modifiedRangeStart = 0
    else
      modifiedRangeStart = -(rangeStart + 1)
    end

    if rangeEnd == -1 then
      modifiedRangeEnd = 0
    else
      modifiedRangeEnd = -(rangeEnd + 1)
    end

    local ids = rcall("LRANGE", listKey, modifiedRangeEnd, modifiedRangeStart)
    -- Reverse in Lua to keep ascending order consistent with what the
    -- previous TypeScript layer used to do after the range call.
    local reversed = {}
    for i = #ids, 1, -1 do
      reversed[#reversed + 1] = ids[i]
    end
    return reversed
  else
    return rcall("LRANGE", listKey, rangeStart, rangeEnd)
  end
end

for i = 4, #ARGV do
  local stateKey = prefix .. ARGV[i]
  local ids = {}

  if ARGV[i] == "wait" or ARGV[i] == "paused" then
    -- Markers in waitlist DEPRECATED in v5: Remove in v6.
    local marker = rcall("LINDEX", stateKey, -1)
    if marker and string.sub(marker, 1, 2) == "0:" then
      local count = rcall("LLEN", stateKey)
      if count > 1 then
        rcall("RPOP", stateKey)
        ids = getRangeInList(stateKey, asc, rangeStart, rangeEnd)
      end
    else
      ids = getRangeInList(stateKey, asc, rangeStart, rangeEnd)
    end
  elseif ARGV[i] == "active" then
    ids = getRangeInList(stateKey, asc, rangeStart, rangeEnd)
  else
    if asc == "1" then
      ids = rcall("ZRANGE", stateKey, rangeStart, rangeEnd)
    else
      ids = rcall("ZREVRANGE", stateKey, rangeStart, rangeEnd)
    end
  end

  results[#results + 1] = ids
  results[#results + 1] = fetchJobs(ids)
end

return results
