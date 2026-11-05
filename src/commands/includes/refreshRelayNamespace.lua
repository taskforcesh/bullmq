--[[
  Keeps every key of a relay namespace expiring on its own, so a namespace
  whose nodes all vanish leaves nothing behind, even if no other node ever
  sweeps it:
    - node records and inboxes expire with their node's lease;
    - routing keys (nodes, started, subs, cleanup) with the longest lease;
    - :mid and :layout with the longest lease or the last retained message,
      whichever ends later;
    - retained messages and their index with their own expiry.
  Called after every change to the node set or to retained messages.
]]

--- @include "relayTime"

local function refreshRelayNamespace(baseKey, nodesKey, now)
  local nodesUntil = getRelayLastScore(nodesKey)
  local routingKeys = { nodesKey, baseKey .. ":started", baseKey .. ":subs",
    baseKey .. ":cleanup" }
  if nodesUntil > now then
    for i = 1, #routingKeys do
      rcall("PEXPIREAT", routingKeys[i], nodesUntil)
    end
  else
    -- No live node: every subscription left belongs to a dead one.
    rcall("UNLINK", unpack(routingKeys))
  end

  local keepUntil = math.max(nodesUntil,
    getRelayLastScore(baseKey .. ":retained"))
  if keepUntil > now then
    rcall("PEXPIREAT", baseKey .. ":mid", keepUntil)
    rcall("PEXPIREAT", baseKey .. ":layout", keepUntil)
  else
    rcall("UNLINK", baseKey .. ":mid", baseKey .. ":layout")
  end
end
