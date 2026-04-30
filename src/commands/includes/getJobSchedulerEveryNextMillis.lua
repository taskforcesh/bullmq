

local function getJobSchedulerEveryNextMillis(prevMillis, every, now, offset, startDate)
    local nextMillis
    if not prevMillis then
        if startDate then
            -- Assuming startDate is passed as milliseconds from JavaScript
            nextMillis = tonumber(startDate)
            nextMillis = nextMillis > now and nextMillis or now
        else
            if offset and offset > 0 then
                -- Align to the next slot that respects the offset
                nextMillis = math.floor(now / every) * every + offset
                if nextMillis <= now then
                    nextMillis = nextMillis + every
                end
            else
                nextMillis = now
            end
        end
    else
        nextMillis = prevMillis + every
        -- check if we may have missed some iterations
        if nextMillis < now then
            -- Use the same offset-aware alignment as the initial branch
            -- above so a non-zero offset is preserved across catch-ups
            -- instead of being flattened to (slot + every). When the
            -- aligned slot is itself still in the past, advance by one
            -- full interval; otherwise the aligned slot is the next
            -- iteration.
            local aligned = math.floor(now / every) * every + (offset or 0)
            if aligned <= now then
                nextMillis = aligned + every
            else
                nextMillis = aligned
            end
        end
    end

    if not offset or offset == 0 then
        local timeSlot = math.floor(nextMillis / every) * every;
        offset = nextMillis - timeSlot;
    end

    -- Return a tuple nextMillis, offset
    return math.floor(nextMillis), math.floor(offset)
end
