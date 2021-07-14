--[[
  Get all kind of children counts.
  Input:
    KEYS[1] dependencies key
    KEYS[2] processed key
    KEYS[3] independents key
  Output:
    counts - unprocessed, processed and independent count values
]]
local rcall = redis.call

local counts = {}

if KEYS[1] ~= "" then
  table.insert(counts, "unprocessed")
  table.insert(counts, rcall("SCARD", KEYS[1]))
end

if KEYS[2] ~= "" then
  table.insert(counts, "processed")
  table.insert(counts, rcall("HLEN", KEYS[2]))
end

if KEYS[3] ~= "" then
  table.insert(counts, "independents")
  table.insert(counts, rcall("SCARD", KEYS[3]))
end

return counts