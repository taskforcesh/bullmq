--[[
  Removes relay nodes whose liveness lease expired, together with their
  subscriptions and inboxes. Any node may call it periodically.

  Input:
    KEYS[1] nodes key ({base}:nodes)

    ARGV[1] base key
    ARGV[2] max nodes to remove in this call

  Output:
    Array with the ids of the removed nodes.
]]
local rcall = redis.call

--- @include "includes/removeRelayNode"

local baseKey = ARGV[1]
local limit = tonumber(ARGV[2])
local removed = {}

local nodes = rcall("SMEMBERS", KEYS[1])
for i = 1, #nodes do
  if #removed >= limit then
    break
  end
  local nodeId = nodes[i]
  if rcall("EXISTS", baseKey .. ":alive:" .. nodeId) == 0 then
    removeRelayNode(baseKey, KEYS[1], nodeId)
    removed[#removed + 1] = nodeId
  end
end

return removed
