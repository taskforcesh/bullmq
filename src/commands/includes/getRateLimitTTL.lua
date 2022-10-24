local function getRateLimitTTL(opts, limiterKey)
    local maxJobs = tonumber(opts['limiter'] and opts['limiter']['max'])
    if maxJobs then
        local jobCounter = tonumber(rcall("GET", limiterKey))
        if jobCounter ~= nil and jobCounter >= maxJobs then
            local pttl = rcall("PTTL", KEYS[6])
            if pttl > 0 then 
                return pttl 
            end
        end
    end
    return 0
end
