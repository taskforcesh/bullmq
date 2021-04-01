--[[
      Checks if job is in a given list.

      Input:
        KEYS[1]
        ARGV[1]

      Output:
        1 if element found in the list.
]]
if redis.call("LPOS", KEYS[1] , ARGV[1]) ~= false then
  return 1
end

return nil