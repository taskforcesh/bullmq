--[[
  Get the ready-timestamp (ms since epoch) of the oldest pending job across
  the 'wait' list, every priority level currently populated in the
  'prioritized' zset, and any 'delayed' job whose delay has already elapsed.

  A job's "ready timestamp" is when its timestamp + delay elapses, i.e. when
  it becomes eligible to run. For a job that is not yet due, this is a
  timestamp in the future, so callers computing an "age" from it should clamp
  to zero rather than treating it as overdue.

  The 'prioritized' zset is scored by priority first (see
  getPriorityScore.lua: score = priority * 0x100000000 + counter), not by
  age, so its head/tail don't reveal the oldest job overall - a low-priority
  job can sit indefinitely behind a stream of fresher high-priority ones.
  Rather than requiring the caller to know which priority levels are in use
  (as getCountsPerPriority does) or scanning the whole zset, this walks it
  one populated priority band at a time: ZRANGEBYSCORE jumps straight to the
  next band in use (skipping any unused ones in between), and since scores
  within a band are ascending by insertion order, that same result is
  already that band's oldest member. Total cost is O(k log n), where k is
  the number of distinct priority levels actually populated, not the number
  of jobs.

    Input:
      KEYS[1] 'prefix'

    Output:
      the ready timestamp of the oldest matching job, or false if there are
      none.
]]
local rcall = redis.call
local prefix = KEYS[1]
local waitKey = prefix .. 'wait'
local prioritizedKey = prefix .. 'prioritized'
local delayedKey = prefix .. 'delayed'
local priorityScoreBand = 0x100000000

local oldestTimestamp = nil

local function considerJobId(jobId)
  if not jobId then
    return
  end
  local fields = rcall('HMGET', prefix .. jobId, 'timestamp', 'delay')
  local timestamp = tonumber(fields[1])
  if not timestamp then
    return
  end
  local readyTimestamp = timestamp + (tonumber(fields[2]) or 0)
  if oldestTimestamp == nil or readyTimestamp < oldestTimestamp then
    oldestTimestamp = readyTimestamp
  end
end

-- The 'wait' list is FIFO (new jobs pushed to the head), so the tail is the
-- oldest. Queues that predate BullMQ's dedicated marker key may still have a
-- deprecated "0:"-prefixed marker entry at the tail; skip over it if so.
local function oldestWaitingJobId()
  local jobId = rcall('LINDEX', waitKey, -1)
  if jobId and string.sub(jobId, 1, 2) == '0:' then
    return rcall('LINDEX', waitKey, -2)
  end
  return jobId
end

considerJobId(oldestWaitingJobId())

local nextScore = 0
while true do
  local found = rcall('ZRANGEBYSCORE', prioritizedKey, nextScore, '+inf',
    'WITHSCORES', 'LIMIT', 0, 1)
  if #found == 0 then
    break
  end
  considerJobId(found[1])
  local priority = math.floor(tonumber(found[2]) / priorityScoreBand)
  nextScore = (priority + 1) * priorityScoreBand
end

-- The 'delayed' zset is scored by ready time ascending, so the head is the
-- most overdue (or the soonest to become ready).
local delayedIds = rcall('ZRANGE', delayedKey, 0, 0)
considerJobId(delayedIds[1])

if oldestTimestamp == nil then
  return false
end
return oldestTimestamp
