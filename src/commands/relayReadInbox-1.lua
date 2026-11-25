--[[
  Reads a batch and atomically marks its entries as in flight so publish-time
  trimming does not count them as dropped before the reader dispatches them.

  Input:
    KEYS[1] nodes key ({base}:nodes)

    ARGV[1] base key
    ARGV[2] node id
    ARGV[3] cursor (id of the last consumed entry)
    ARGV[4] count

  Output:
    XREAD result, or nil if there are no entries or the lease expired.
]]
local rcall = redis.call
local nodeKey = ARGV[1] .. ":" .. ARGV[2] .. ":node"
local inboxKey = ARGV[1] .. ":" .. ARGV[2] .. ":inbox"

if rcall("EXISTS", nodeKey) == 0 then
  return nil
end

local result = rcall("XREAD", "COUNT", ARGV[4], "STREAMS", inboxKey, ARGV[3])
local inFlight = ARGV[3]
if result then
  local entries = result[1][2]
  inFlight = entries[#entries][1]
end
rcall("HSET", nodeKey, "cursor", ARGV[3], "inFlight", inFlight)
return result
