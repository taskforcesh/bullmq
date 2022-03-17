--[[
  Move next job to be processed to active, lock it and fetch its data. The job
  may be delayed, in that case we need to move it to the delayed set instead.

  This operation guarantees that the worker owns the job during the lock
  expiration time. The worker is responsible of keeping the lock fresh
  so that no other worker picks this job again.

  Input:
      KEYS[1] wait key
      KEYS[2] active key
      KEYS[3] priority key
      KEYS[4] stream events key
      KEYS[5] stalled key

      -- Rate limiting
      KEYS[6] rate limiter key
      KEYS[7] delayed key

      -- Delay events
      KEYS[8] delay stream key

      -- Arguments
      ARGV[1] key prefix
      ARGV[2] timestamp
      ARGV[3] optional job ID
      ARGV[4] opts

      opts - token - lock token
      opts - lockDuration
      opts - limiter
]]

local jobId
local rcall = redis.call

-- Includes
--- @include "includes/moveJobFromWaitToActive"

if(ARGV[3] ~= "") then
  jobId = ARGV[3]

  -- clean stalled key
  rcall("SREM", KEYS[5], jobId)
else
  -- no job ID, try non-blocking move from wait to active
  jobId = rcall("RPOPLPUSH", KEYS[1], KEYS[2])
end

if jobId then
  local opts = cmsgpack.unpack(ARGV[4])

  return moveJobFromWaitToActive(KEYS, ARGV[1], jobId, ARGV[2], opts)
end
