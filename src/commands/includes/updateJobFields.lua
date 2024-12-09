--[[
  Function to update a bunch of fields in a job.
]]
local function updateJobFields(jobKey, msgpackedFields)
    if msgpackedFields then
        local fieldsToUpdate = cmsgpack.unpack(msgpackedFields)
        if fieldsToUpdate then
            redis.call("HMSET", jobKey, unpack(fieldsToUpdate))
        end
    end
end
