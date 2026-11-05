--[[
    Remove a job from all the statuses it may be in as well as all its data.
    In order to be able to remove a job, it cannot be active.

    Input:
      KEYS[1] jobKey
      KEYS[2] meta key
      
      ARGV[1] prefix
      ARGV[2] jobId

    Events:
      'removed' for every children removed
]]

-- Includes
--- @include "includes/removeJobWithChildren"

local prefix = ARGV[1]
local jobId = ARGV[2]

local jobKey = KEYS[1]
local metaKey = KEYS[2]

local options = {
  removeChildren = "1",
  ignoreProcessed = true,
  ignoreLocked = true
}

removeJobChildren(prefix, jobKey, options) 
