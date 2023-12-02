--[[
  Function to decrement attemptsMade.
  It also increments softAttemptsMade.
]]

local function decrementAttemptsMade(jobKey)
  rcall("HINCRBY", jobKey, "attemptsMade", -1)
  rcall("HINCRBY", jobKey, "sam", 1)
end
