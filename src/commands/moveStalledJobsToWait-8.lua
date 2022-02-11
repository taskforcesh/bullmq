--[[
  Move stalled jobs to wait.

    Input:
      KEYS[1] 'stalled' (SET)
      KEYS[2] 'wait',   (LIST)
      KEYS[3] 'active', (LIST)
      KEYS[4] 'failed', (ZSET)
      KEYS[5] 'stalled-check', (KEY)

      KEYS[6] 'meta', (KEY)
      KEYS[7] 'paused', (LIST)

      KEYS[8] 'event stream' (STREAM)

      ARGV[1]  Max stalled job count
      ARGV[2]  queue.toKey('')
      ARGV[3]  timestamp
      ARGV[4]  max check time

    Events:
      'stalled' with stalled job id.
]]
local rcall = redis.call

-- Includes
--- @include "includes/batches"
--- @include "includes/trimEvents"

-- Check if we need to check for stalled jobs now.
if rcall("EXISTS", KEYS[5]) == 1 then return {{}, {}} end

rcall("SET", KEYS[5], ARGV[3], "PX", ARGV[4])

-- Move all stalled jobs to wait
local stalling = rcall('SMEMBERS', KEYS[1])
local stalled = {}
local failed = {}
if (#stalling > 0) then

    local dst
    -- wait or paused destination
    if rcall("HEXISTS", KEYS[6], "paused") ~= 1 then
        dst = KEYS[2]
    else
        dst = KEYS[7]
    end

    rcall('DEL', KEYS[1])

    local MAX_STALLED_JOB_COUNT = tonumber(ARGV[1])

    -- Remove from active list
    for i, jobId in ipairs(stalling) do
        local jobKey = ARGV[2] .. jobId

        -- Check that the lock is also missing, then we can handle this job as really stalled.
        if (rcall("EXISTS", jobKey .. ":lock") == 0) then
            --  Remove from the active queue.
            local removed = rcall("LREM", KEYS[3], 1, jobId)

            if (removed > 0) then
                -- If this job has been stalled too many times, such as if it crashes the worker, then fail it.
                local stalledCount = rcall("HINCRBY", jobKey, "stalledCounter",
                                           1)
                if (stalledCount > MAX_STALLED_JOB_COUNT) then
                    local failedReason = "job stalled more than allowable limit" 
                    rcall("ZADD", KEYS[4], ARGV[3], jobId)
                    rcall("HMSET", jobKey, "failedReason",
                          failedReason, "finishedOn", ARGV[3])
                    rcall("XADD", KEYS[8], "*", "event", "failed", "jobId",
                          jobId, 'prev', 'active', 'failedReason',
                          failedReason)
                    table.insert(failed, jobId)
                else
                    -- Move the job back to the wait queue, to immediately be picked up by a waiting worker.
                    rcall("RPUSH", dst, jobId)
                    rcall("XADD", KEYS[8], "*", "event", "waiting", "jobId",
                          jobId, 'prev', 'active')

                    -- Emit the stalled event
                    rcall("XADD", KEYS[8], "*", "event", "stalled", "jobId",
                          jobId)
                    table.insert(stalled, jobId)
                end
            end
        end
    end
end

-- Mark potentially stalled jobs
local active = rcall('LRANGE', KEYS[3], 0, -1)

if (#active > 0) then
  for from, to in batches(#active, 7000) do
    rcall('SADD', KEYS[1], unpack(active, from, to))
  end
end

trimEvents(KEYS[6], KEYS[8])

return {failed, stalled}
