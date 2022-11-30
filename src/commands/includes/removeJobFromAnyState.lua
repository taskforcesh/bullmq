--[[
  Function to remove from any state.

  returns:
    prev state
]]

local function removeJobFromAnyState( prefix, jobId)
  if rcall("LREM", prefix .. "wait", 0, jobId) == 1 then
    return "wait"
  elseif rcall("LREM", prefix .. "paused", 0, jobId) == 1 then
    return "paused"
  elseif rcall("LREM", prefix .. "active", 0, jobId) == 1 then
    return "active"
  elseif rcall("ZREM", prefix .. "waiting-children", jobId) == 1 then
    return "waiting-children"
  elseif rcall("ZREM", prefix .. "delayed", jobId) == 1 then
    return "delayed"
  elseif rcall("ZREM", prefix .. "completed", jobId) == 1 then
    return "completed"
  elseif rcall("ZREM", prefix .. "failed", jobId) == 1 then
    return "failed"
  end

  return "unknown"
end
