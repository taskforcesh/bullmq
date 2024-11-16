--[[
  Update a job option

  Input:
    KEYS[1] Job id key

    ARGV[1] field
    ARGV[2] value

  Output:
    0 - OK
   -1 - Missing job.
]]
local rcall = redis.call

if rcall("EXISTS", KEYS[1]) == 1 then -- // Make sure job exists

    local opts = rcall("HGET", KEYS[1], "opts")
    local jsonOpts = cjson.decode(opts)
    jsonOpts[ARGV[1]] = ARGV[2]

    rcall("HSET", KEYS[1], "opts", cjson.encode(jsonOpts))
    return 0
else
    return -1
end
