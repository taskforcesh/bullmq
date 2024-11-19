--[[
  Execute migrations.

  Input:
    KEYS[1]  meta key
    KEYS[2]  migrations key
    KEYS[3]  prefix key

    ARGV[1]  current major version
    ARGV[2]  timestamp
    ARGV[3]  current migration execution
]]
local rcall = redis.call

local currentMajorVersion = rcall("HGET", KEYS[1], "mv")

local function getCurrentMigrationNumber(migrationKey)
  local lastExecutedMigration = rcall("LRANGE", migrationKey, -1, -1)

  if #lastExecutedMigration > 0 then
    return tonumber(string.match(lastExecutedMigration[1], "(.*)-.*-.*")) + 1
  else
    return 1
  end
end

local function saveMigration(migrationKey, migrationNumber, timestamp, migrationName)
  rcall("RPUSH", migrationKey, migrationNumber .. "-" .. timestamp .. "-" .. migrationName)
  return migrationNumber + 1
end

if currentMajorVersion then
  if currentMajorVersion == ARGV[1] then
    return 0
  end
else
  local currentMigrationNumber = getCurrentMigrationNumber(KEYS[2])
  if currentMigrationNumber == 1 then
    -- delete deprecated priority
    rcall("DEL", KEYS[3] .. "priority")
    currentMigrationNumber = saveMigration(KEYS[2], currentMigrationNumber, ARGV[2], "removeDeprecatedPriorityKey")
  end

  local currentMigrationExecutionNumber = tonumber(ARGV[3])
  if currentMigrationNumber == 2 then
    -- remove legacy markers
    if currentMigrationNumber >= currentMigrationExecutionNumber then
      return 2
    else
      currentMigrationNumber = saveMigration(KEYS[2], currentMigrationNumber, ARGV[2], "removeLegacyMarkers")
    end
  end

  if currentMigrationNumber == 3 then
    -- migrate deprecated paused key
    if currentMigrationNumber >= currentMigrationExecutionNumber then
      return 3
    else
      currentMigrationNumber = saveMigration(KEYS[2], currentMigrationNumber, ARGV[2], "migrateDeprecatedPausedKey")
    end
  end

  return 0
end
