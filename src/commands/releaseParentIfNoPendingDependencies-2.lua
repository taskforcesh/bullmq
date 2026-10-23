--[[
  Moves a parent out of the waiting-children state if it has no pending
  dependencies left.

  This runs at the end of a flow insert, once every node of the tree has been
  added. During the insert itself a child that already exists and is completed
  only records its processed dependency (see updateExistingJobsParent); the
  parent cannot be released at that point because its remaining children have
  not been added to the dependencies set yet.

  It is a no-op unless the parent still exists and is still scored in its
  queue's waiting-children zset, so it is safe to call for every parent
  touched by a flow.

    Input:
      KEYS[1] parent key
      KEYS[2] parent dependencies key

      ARGV[1] parent queue key
      ARGV[2] parent id
      ARGV[3] timestamp
]]
local rcall = redis.call

if rcall("HGET", KEYS[1], "flowAttachmentFailed") then
    rcall("HDEL", KEYS[1], "flowAttachmentFailed")
    return
end

-- Includes
--- @include "includes/moveParentToWaitIfNoPendingDependencies"

moveParentToWaitIfNoPendingDependencies(ARGV[1], KEYS[2], KEYS[1], ARGV[2],
                                        ARGV[3])
