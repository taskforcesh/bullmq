--[[
  Get jobs (id + data) for the provided states.

  Job ids and their hashes are read in the same script so that ids whose hash
  disappears after the id is read (but before the job is loaded) do not appear
  in the result set. Ids without a job hash (for example the deprecated wait
  list marker entry stored in the list) are skipped. For bounded ranges the
  script iterates forward using the range offset as a cursor to backfill
  skipped ids, preserving the requested page size when possible.

    Input:
      KEYS[1]    'prefix'

      ARGV[1]    start
      ARGV[2]    end
      ARGV[3]    asc ('1' | '0')
      ARGV[4]    max iterations (backfill bound)
      ARGV[5...] types

    Output:
      results grouped per requested type; each entry is a
      {jobId, {field, value, ...}} tuple
]]
local rcall = redis.call
local prefix = KEYS[1]
local rangeStart = tonumber(ARGV[1])
local rangeEnd = tonumber(ARGV[2])
local asc = ARGV[3] == "1"
local max_iterations = tonumber(ARGV[4])
local results = {}

local function isListType(stateType)
  return stateType == "wait" or stateType == "paused" or stateType == "active"
end

-- Fetch a slice of ids for the given state respecting the requested order.
local function fetchIds(stateKey, stateType, sliceStart, sliceEnd, listLength)
  if isListType(stateType) then
    if asc then
      local modifiedRangeStart
      local modifiedRangeEnd
      if sliceStart == -1 then
        modifiedRangeStart = 0
      else
        modifiedRangeStart = -(sliceStart + 1)
      end

      if sliceEnd == -1 then
        modifiedRangeEnd = 0
      else
        modifiedRangeEnd = -(sliceEnd + 1)
      end

      -- Ascending list slices use negative indexes. When the whole window is
      -- beyond the list length Redis clamps both indexes to 0 and LRANGE would
      -- return the head element, so guard against out-of-range slices with LLEN.
      if listLength ~= nil and sliceStart >= 0 and sliceEnd >= 0 and sliceStart >= listLength then
        return {}
      end

      local ids = rcall("LRANGE", stateKey, modifiedRangeEnd, modifiedRangeStart)
      local reversed = {}
      for i = #ids, 1, -1 do
        reversed[#reversed + 1] = ids[i]
      end
      return reversed
    else
      return rcall("LRANGE", stateKey, sliceStart, sliceEnd)
    end
  else
    if asc then
      return rcall("ZRANGE", stateKey, sliceStart, sliceEnd)
    else
      return rcall("ZREVRANGE", stateKey, sliceStart, sliceEnd)
    end
  end
end

-- Fetch the job hash for an id and append it when present.
local function appendJob(entries, jobId)
  local jobData = rcall("HGETALL", prefix .. jobId)
  if #jobData > 0 then
    entries[#entries + 1] = {jobId, jobData}
  end
end

local function cleanupDeprecatedMarker(stateKey, stateType)
  if stateType == "wait" or stateType == "paused" then
    local marker = rcall("LINDEX", stateKey, -1)
    if marker and string.sub(marker, 1, 2) == "0:" then
      local count = rcall("LLEN", stateKey)
      if count > 1 then
        rcall("RPOP", stateKey)
        return count - 1
      end
      return 0
    end
  end
end

local function collectJobs(stateKey, stateType)
  local entries = {}
  local listLength
  local cleanedListLength = cleanupDeprecatedMarker(stateKey, stateType)

  if asc and isListType(stateType) and rangeStart >= 0 and rangeEnd >= 0 then
    if cleanedListLength ~= nil then
      listLength = cleanedListLength
    else
      listLength = rcall("LLEN", stateKey)
    end
  end

  -- Unbounded or negative ranges: fetch the exact window and skip missing ids.
  if rangeStart < 0 or rangeEnd < 0 then
    local ids = fetchIds(stateKey, stateType, rangeStart, rangeEnd, listLength)
    for i = 1, #ids do
      appendJob(entries, ids[i])
    end
    return entries
  end

  -- Bounded range: iterate forward to backfill skipped ids.
  local needed = rangeEnd - rangeStart + 1
  local cursor = rangeStart
  local iterations = 0
  while #entries < needed and iterations < max_iterations do
    local ids = fetchIds(stateKey, stateType, cursor, cursor + needed - 1, listLength)
    if #ids == 0 then
      break
    end
    for i = 1, #ids do
      if #entries >= needed then
        break
      end
      appendJob(entries, ids[i])
    end
    cursor = cursor + #ids
    iterations = iterations + 1
  end

  return entries
end

for i = 5, #ARGV do
  local stateType = ARGV[i]
  local stateKey = prefix .. stateType
  results[#results + 1] = collectJobs(stateKey, stateType)
end

return results
