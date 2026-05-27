--[[
  Function to store a job scheduler
]]
local function storeJobScheduler(schedulerId, schedulerKey, repeatKey, nextMillis, opts,
  templateData, templateOpts)
  rcall("ZADD", repeatKey, nextMillis, schedulerId)

  local optionalValues = {}
  if opts['tz'] then
    table.insert(optionalValues, "tz")
    table.insert(optionalValues, opts['tz'])
  end

  if opts['limit'] then
    table.insert(optionalValues, "limit")
    table.insert(optionalValues, opts['limit'])
  end

  if opts['pattern'] then
    table.insert(optionalValues, "pattern")
    table.insert(optionalValues, opts['pattern'])
  end

  if opts['startDate'] then
    table.insert(optionalValues, "startDate")
    table.insert(optionalValues, opts['startDate'])
  end

  if opts['endDate'] then
    table.insert(optionalValues, "endDate")
    table.insert(optionalValues, opts['endDate'])
  end

  if opts['every'] then
    table.insert(optionalValues, "every")
    table.insert(optionalValues, opts['every'])
  end

  if opts['offset'] then
    table.insert(optionalValues, "offset")
    table.insert(optionalValues, opts['offset'])
  else
    local offset = rcall("HGET", schedulerKey, "offset")
    if offset then
      table.insert(optionalValues, "offset")
      table.insert(optionalValues, tonumber(offset))
    end
  end

  local jsonTemplateOpts = cjson.encode(templateOpts)
  if jsonTemplateOpts and jsonTemplateOpts ~= '{}' then
    table.insert(optionalValues, "opts")
    table.insert(optionalValues, jsonTemplateOpts)
  end

  if templateData and templateData ~= '{}' then
    table.insert(optionalValues, "data")
    table.insert(optionalValues, templateData)
  end

  table.insert(optionalValues, "ic")
  table.insert(optionalValues, rcall("HGET", schedulerKey, "ic") or 1)

  rcall("DEL", schedulerKey) -- remove all attributes and then re-insert new ones
  rcall("HMSET", schedulerKey, "name", opts['name'], unpack(optionalValues))
end
