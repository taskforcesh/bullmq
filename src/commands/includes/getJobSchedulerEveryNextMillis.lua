

local function getJobSchedulerEveryNextMillis(prevMillis, every, now, offset, startDate)
    local nextMillis
    if not prevMillis then
        if startDate then
            -- Assuming startDate is passed as milliseconds from JavaScript
            nextMillis = tonumber(startDate)
            nextMillis = nextMillis > now and nextMillis or now
        else
            nextMillis = now
            -- For the first iteration with no startDate and an explicit
            -- offset, align nextMillis to the next offset slot strictly
            -- after now. Without this the user-supplied offset is
            -- recorded but ignored, and the first job fires at now
            -- instead of the next aligned timestamp (issue #3705).
            if offset and offset > 0 then
                local aligned = math.floor(nextMillis / every) * every + offset
                if aligned <= nextMillis then
                    aligned = aligned + every
                end
                nextMillis = aligned
            end
        end
    else
        nextMillis = prevMillis + every
        -- check if we may have missed some iterations
        if nextMillis < now then
            nextMillis = math.floor(now / every) * every + every + (offset or 0)
        end
    end

    if not offset or offset == 0 then
        local timeSlot = math.floor(nextMillis / every) * every;
        offset = nextMillis - timeSlot;
    end

    -- Return a tuple nextMillis, offset
    return math.floor(nextMillis), math.floor(offset)
end
