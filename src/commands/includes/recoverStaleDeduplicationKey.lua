--[[
  Function to recover a stale deduplication key.
  When the existing deduplication key has no expiry (simple mode, or
  keepLastIfActive after the key was persisted), it should disappear
  when the winning job finishes. If that job key no longer exists
  because of an outage, the deduplication key is stale, so we discard it
  and start a new deduplication window with the incoming job.
  Returns true if the stale key was recovered, false otherwise.
]]
--- @include "setDeduplicationKey"

local function recoverStaleDeduplicationKey(deduplicationKey, prefix, currentDeduplicatedJobId, jobId,
    deduplicationId, deduplicationOpts)
    if currentDeduplicatedJobId and rcall('PTTL', deduplicationKey) == -1 and
        rcall('EXISTS', prefix .. currentDeduplicatedJobId) == 0 then
        rcall('DEL', deduplicationKey)
        -- Discard any pending next-job payload stored for the stale winner,
        -- otherwise it would be resurrected when this job finalizes.
        rcall('DEL', prefix .. "dn:" .. deduplicationId)
        if deduplicationOpts['keepLastIfActive'] then
            rcall('SET', deduplicationKey, jobId)
        else
            setDeduplicationKey(deduplicationKey, jobId, deduplicationOpts)
        end
        return true
    end
    return false
end
