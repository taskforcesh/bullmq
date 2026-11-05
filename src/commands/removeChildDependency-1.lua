--[[
  Break parent-child dependency by removing
  child reference from parent

  Input:
    KEYS[1] 'key' prefix,

    ARGV[1] job key
    ARGV[2] parent key

    Output:
       0  - OK
       1  - There is not relationship.
      -1  - Missing job key
      -5  - Missing parent key
]]
local rcall = redis.call
local jobKey = ARGV[1]
local parentKey = ARGV[2]

-- Includes
--- @include "includes/removeParentDependencyKey"

if rcall("EXISTS", jobKey) ~= 1 then return -1 end

if rcall("EXISTS", parentKey) ~= 1 then return -5 end

if removeParentDependencyKey(jobKey, false, parentKey, KEYS[1], nil) then
  rcall("HDEL", jobKey, "parentKey", "parent")

  return 0
else
  return 1
end