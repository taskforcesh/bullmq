--[[
  Updates the delay set, by picking a delayed job that should
  be processed now.

     Input:
      KEYS[1] 'delayed'
      KEYS[2] 'wait'
      KEYS[3] 'priority'
      KEYS[4] 'paused'
      KEYS[5] 'meta'

      KEYS[6] event's stream
      KEYS[7] delayed stream

      ARGV[1] queue.toKey('')
      ARGV[2] delayed timestamp

     Events:
      'waiting'
]] local rcall = redis.call

-- Try to get as much as 1000 jobs at once
local jobs = rcall("ZRANGEBYSCORE", KEYS[1], 0, tonumber(ARGV[2]) * 0x1000,
                   "LIMIT", 0, 1000)

if (#jobs > 0) then
    rcall("ZREM", KEYS[1], unpack(jobs))

    -- check if we need to use push in paused instead of waiting
    local target
    if rcall("HEXISTS", KEYS[5], "paused") ~= 1 then
        target = KEYS[2]
    else
        target = KEYS[4]
    end

    for _, jobId in ipairs(jobs) do
        local priority =
            tonumber(rcall("HGET", ARGV[1] .. jobId, "priority")) or 0

        if priority == 0 then
            -- LIFO or FIFO
            rcall("LPUSH", target, jobId)
        else
            -- Priority add
            rcall("ZADD", KEYS[3], priority, jobId)
            local count = rcall("ZCOUNT", KEYS[3], 0, priority)

            local len = rcall("LLEN", target)
            local id = rcall("LINDEX", target, len - (count - 1))
            if id then
                rcall("LINSERT", target, "BEFORE", id, jobId)
            else
                rcall("RPUSH", target, jobId)
            end
        end

        -- Emit waiting event
        rcall("XADD", KEYS[6], "*", "event", "waiting", "jobId", jobId, "prev",
              "delayed")
        rcall("HSET", ARGV[1] .. jobId, "delay", 0)
    end
end

local nextTimestamp = rcall("ZRANGE", KEYS[1], 0, 0, "WITHSCORES")[2]
local id
if (nextTimestamp ~= nil) then
    nextTimestamp = nextTimestamp / 0x1000
    id = rcall("XADD", KEYS[7], "*", "nextTimestamp", nextTimestamp)
end

return {nextTimestamp, id}
