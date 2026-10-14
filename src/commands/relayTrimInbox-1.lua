--[[
  Removes the consumed entries of a relay node's inbox (up to the reader's
  cursor) and the oldest entries beyond the max length, and returns the number
  of entries left: the messages the node hasn't read yet. The backlog and the
  number of dropped entries are recorded on the node.

  Input:
    KEYS[1] nodes key ({base}:nodes)

    ARGV[1] base key
    ARGV[2] node id
    ARGV[3] cursor (id of the last consumed entry, "0-0" if none)
    ARGV[4] max length

  Output:
    Number of entries left in the inbox.
]]
local rcall = redis.call

--- @include "includes/batches"

local inboxKey = ARGV[1] .. ":" .. ARGV[2] .. ":inbox"
local nodeKey = ARGV[1] .. ":" .. ARGV[2] .. ":node"
local cursor = ARGV[3]

if cursor ~= "0-0" and cursor ~= "0" then
  -- At most 10000 per call; the next call removes the rest.
  local consumed = rcall("XRANGE", inboxKey, "-", cursor, "COUNT", 10000)
  if #consumed > 0 then
    local ids = {}
    for i = 1, #consumed do
      ids[i] = consumed[i][1]
    end
    for from, to in batches(#ids, 7000) do
      rcall("XDEL", inboxKey, unpack(ids, from, to))
    end
  end
end

local dropped = rcall("XTRIM", inboxKey, "MAXLEN", tonumber(ARGV[4]))
local backlog = rcall("XLEN", inboxKey)
-- Only a live node has a record (writing to a missing one would create it
-- without an expiry).
if rcall("EXISTS", nodeKey) == 1 then
  rcall("HSET", nodeKey, "backlog", backlog)
  if dropped > 0 then
    rcall("HINCRBY", nodeKey, "dropped", dropped)
  end
end
return backlog
