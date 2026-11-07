--[[
  Redis only checks maxmemory on the first write command flagged as
  "may grow memory" that a script executes. Performing a write that is not
  flagged that way first (DEL of a key that never exists) lets the rest of
  the script run while Redis is over maxmemory, so workers can keep
  processing jobs and memory can still be freed.

  Producer scripts must NOT use this, so they keep their backpressure.
]]

local function allowWritesOnOOM(key)
  rcall("DEL", key .. ":__oom_guard__")
end
