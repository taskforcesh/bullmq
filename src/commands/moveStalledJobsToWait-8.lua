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
]] -- Includes
--- @include "includes/checkStalledJobs"
return checkStalledJobs(KEYS[1], KEYS[2], KEYS[3], KEYS[4], KEYS[5], KEYS[6],
                        KEYS[7], KEYS[8], ARGV[1], ARGV[2], ARGV[3], ARGV[4])
