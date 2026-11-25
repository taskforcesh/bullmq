--[[
  Records the last inbox position acknowledged by the reader.

  Input:
    KEYS[1] nodes key ({base}:nodes)

    ARGV[1] base key
    ARGV[2] node id
    ARGV[3] cursor (id of the last consumed entry)
]]
local rcall = redis.call
local nodeKey = ARGV[1] .. ":" .. ARGV[2] .. ":node"

if rcall("EXISTS", nodeKey) == 1 then
  rcall("HSET", nodeKey, "cursor", ARGV[3])
end

return 1
