--[[
  Relay topic grammar, shared by every relay script.

  Topics are dot-separated keypaths, e.g. "queues.emails.jobs.42.progress".
    - Segments match [A-Za-z0-9_:%-]+ (other characters must be
      percent-encoded by the caller).
    - Max 512 characters and 16 segments.
  Patterns may also contain wildcards:
    - "*" matches exactly one segment.
    - ">" matches one or more trailing segments (last segment only).

  Node and endpoint ids match [A-Za-z0-9_-]{1,64}.
]]

local function splitRelayTopic(value)
  local segments = {}
  local start = 1
  while true do
    local dot = string.find(value, ".", start, true)
    if not dot then
      segments[#segments + 1] = string.sub(value, start)
      return segments
    end
    segments[#segments + 1] = string.sub(value, start, dot - 1)
    start = dot + 1
  end
end

-- Returns the segments of a valid topic (or pattern), or nil if invalid.
local function parseRelayTopic(value, allowWildcards)
  if type(value) ~= "string" or #value == 0 or #value > 512 then
    return nil
  end
  local segments = splitRelayTopic(value)
  local count = #segments
  if count > 16 then
    return nil
  end
  for i = 1, count do
    local segment = segments[i]
    if allowWildcards and segment == "*" then
      -- valid
    elseif allowWildcards and segment == ">" then
      if i ~= count then
        return nil
      end
    elseif not string.match(segment, "^[%w_:%%%-]+$") then
      return nil
    end
  end
  return segments
end

local function matchRelayTopic(patternSegments, topicSegments)
  local topicCount = #topicSegments
  for i = 1, #patternSegments do
    local segment = patternSegments[i]
    if segment == ">" then
      return topicCount >= i
    end
    if i > topicCount then
      return false
    end
    if segment ~= "*" and segment ~= topicSegments[i] then
      return false
    end
  end
  return #patternSegments == topicCount
end

-- Index bucket of a pattern: its literal root, or "*" for wildcard roots.
local function getRelayPatternRoot(patternSegments)
  local root = patternSegments[1]
  if root == "*" or root == ">" then
    return "*"
  end
  return root
end

local function hasRelayWildcards(segments)
  for i = 1, #segments do
    if segments[i] == "*" or segments[i] == ">" then
      return true
    end
  end
  return false
end

local function isValidRelayId(id)
  return type(id) == "string" and #id > 0 and #id <= 64 and
    string.match(id, "^[%w_%-]+$") ~= nil
end
