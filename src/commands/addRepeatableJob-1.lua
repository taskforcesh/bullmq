--[[
  Adds a repeatable job

    Input:
      KEYS[1] 'repeat' key

      ARGV[1] next milliseconds
      ARGV[2] msgpacked options
            [1]  name
            [2]  tz?
            [3]  patten?
            [4]  endDate?
            [5]  every?
      ARGV[3] legacy custom key TODO: remove this logic in next breaking change
      ARGV[4] custom key
      ARGV[5] skipCheckExists

      Output:
        repeatableKey  - OK
]]
local rcall = redis.call
local repeatKey = KEYS[1]
local nextMilli = ARGV[1]
local legacyCustomKey = ARGV[3]
local customKey = ARGV[4]

local function storeRepeatableJob(repeatKey, customKey, nextMilli, rawOpts)
  rcall("ZADD", repeatKey, nextMilli, customKey)
  local opts = cmsgpack.unpack(rawOpts)

  local optionalValues = {}
  if opts['tz'] then
    table.insert(optionalValues, "tz")
    table.insert(optionalValues, opts['tz'])
  end

  if opts['pattern'] then
    table.insert(optionalValues, "pattern")
    table.insert(optionalValues, opts['pattern'])
  end

  if opts['endDate'] then
    table.insert(optionalValues, "endDate")
    table.insert(optionalValues, opts['endDate'])
  end
  
  if opts['every'] then
    table.insert(optionalValues, "every")
    table.insert(optionalValues, opts['every'])
  end

  rcall("HMSET", repeatKey .. ":" .. customKey, "name", opts['name'],
    unpack(optionalValues))

  return customKey
end

local legacyRepeatableJobExists = rcall("ZSCORE", repeatKey, legacyCustomKey)

if ARGV[5] == '0' or legacyRepeatableJobExists  ~= false then
  if legacyRepeatableJobExists ~= false then
    rcall("ZADD", repeatKey, nextMilli, legacyCustomKey)
    return legacyCustomKey
  elseif rcall("ZSCORE", repeatKey, customKey) ~= false then
    return storeRepeatableJob(repeatKey, customKey, nextMilli, ARGV[2])
  end
else
  return storeRepeatableJob(repeatKey, customKey, nextMilli, ARGV[2])
end

return ''