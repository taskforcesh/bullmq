--[[
  Remove old legacy markers 0:0 from wait states and finished states if needed

  Input:
    KEYS[1] wait key
    KEYS[2] paused key
    KEYS[3] meta key
    KEYS[4] completed key
    KEYS[5] failed key

    ARGV[1] prefix key
]]

local rcall = redis.call
local waitKey = KEYS[1]
local pausedKey = KEYS[2]
local completedKey = KEYS[4]
local failedKey = KEYS[5]

-- Includes
--- @include "includes/isQueuePaused"
--- @include "includes/getZSetItems"
--- @include "includes/removeJobKeys"

local isPaused = isQueuePaused(KEYS[3])

local function removeMarkerFromWait( stateKey)
    local marker = rcall("LINDEX", stateKey, -1)
    if marker and string.sub(marker, 1, 2) == "0:" then
        rcall("RPOP", stateKey)
    end
end

local function removeMarkerFromFinished(keyName, prefix)
    local jobs = getZSetItems(keyName, 0)
    if #jobs > 0 then
        for _, jobId in ipairs(jobs) do
            local jobKey = prefix .. jobId
            if jobId and string.sub(jobId, 1, 2) == "0:" then
                rcall("ZREM", keyName, jobId)
                removeJobKeys(jobKey)
            end
        end
   end
end
  
if isPaused then
    removeMarkerFromWait(pausedKey)
else
    removeMarkerFromWait(waitKey)
end

-- in cases were they got processed and finished
removeMarkerFromFinished(completedKey, ARGV[1])
removeMarkerFromFinished(failedKey, ARGV[1])