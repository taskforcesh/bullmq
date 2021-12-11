--- file: math.lua
local function sign(x)
  x = tonumber(x)
  if x == 0 then return 0 end
  return x < 0 and -1 or 1
end
