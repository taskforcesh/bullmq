--[[
  Get Jobs by filter criteria. The criteria is specified as a Mongo query style JSON document

     Input:
        KEYS[1] key for jobs in a given status
        KEYS[2] key for cursor
        ARGV[1] filter criteria as a Mongo styled query as a json encoded string
        ARGV[2] count
        ARGV[3] asc
        ARGV[4] batchSize - the max number of jobs to process per iteration

  The filter expression supports the following operators:

    Comparison Query Operators
        $eq, $ne, $gt, $gte, $lt, $lte, $in, $nin, $regex, $iregex, $exists, $type, $size,
        $startsWith, $endsWith, $contains

    Logical Query Operators
        $and, $or, $nor, $not, $xor

    Evaluation Query Operators
        $expr

    Conditional Operators
        $ifNull

  The criteria is compiled into a predicate function which is applied to up to batchSize jobs in this call. Given that
  matching jobs are sparse with respect to the dataset, we want a batch size which allows
   1. minimizing overall latency while scanning the data.
   2. amortized cost of multiple calls to get the desired number of results.
   3. amortized cost of compiling the optimized filter.

  The cursor mechanism is to allow iteration through the dataset with state stored on the server.

    Output:
        An array with the following structure:
        [meta, job...]

        Where:
            meta - response metadata as a json encoded string with the following fields:
                - progress: the number of jobs scanned thus far
                - total: total number of jobs in the selected state
                - done: whether the end of the dataset has been reached
                - debug: array of debug messages (if debugging is enabled)
                - iterations: number of iterations performed to get the results
                - remainder: number of jobs which match the criteria but were not returned due to count limit
            job - the matching job objects as json encoded strings
]]
local MIN_BATCH_SIZE = 20
--- Cursor expiration time in seconds
local CURSOR_EXPIRATION = 30

--- INPUTS
local stateKey = KEYS[1]
local cursorKey = KEYS[2]
local criteria = assert(cjson.decode(ARGV[1]), 'Invalid filter criteria. Expected a JSON encoded string')
local batchSize = tonumber(ARGV[4] or MIN_BATCH_SIZE)
local count = tonumber(ARGV[2] or 10)
local asc = (ARGV[3] == "1" or ARGV[3] == "true")


local rcall = redis.call
local currentJobKey = nil


--- Cache resolved field values for the current job. Helpful when multiple predicates refer to the same field
--- eg { $and: [ { 'data.request.priority': { $gt: 5 } }, { 'data.request.priority': { $lt: 10 } } ] }
local cachedValues = {}

local isDebugging = true
--- Response metadata
local responseMeta = {
    ['progress'] = 0,
    ["cursor"] = 0,
    ["total"] = 0
}

--- Fields which are numeric and should be compared as numbers
local NUMERIC_FIELDS = {
    ['timestamp'] = 1,
    ['processedOn'] = 1,
    ['finishedOn'] = 1,
    ['delay'] = 1,
    ['latency'] = 1,
    ['priority'] = 1,
    ['progress'] = 1,
    ['attemptsMade'] = 1,
    ['attemptsStarted'] = 1,
    ['waitTime'] = 1,
    ['runtime'] = 1,
    ['queueTime'] = 1,
    ['stalledCounter'] = 1,
}

--- Fields to include in full text search
local FULL_TEXT_FIELDS = { 'name', 'data', 'stacktrace', 'failedReason', 'returnvalue', 'id' }

local JsType = {
    NULL = 'nil',
    STRING = 'string',
    BOOLEAN = 'boolean',
    NUMBER = 'number',
    FUNCTION = 'function',
    OBJECT = 'object',
    ARRAY = 'array'
}

-- no array, object, or function types
local JS_SIMPLE_TYPES = {
    ['null'] = true,
    ['nil'] = true,
    ['boolean'] = true,
    ['number'] = true,
    ['string'] = true,
}

-- field name aliases. BullMQ uses short names for some fields to save space in Redis. Map user-friendly
-- field names to their short names here.
local FIELD_ALIASES = {
    ["repeatJobKey"] = "rjk",
    ["attemptsStarted"] = "ats",
    ["attemptsMade"] = "atm",
    ["stalledCounter"] = "stc",
    ["processedBy"] = "pb",
    ["nextRepeatableJobId"] = "nrjid",
}

--- Forward declarations
local getFieldResolver

local QueryOperators = {}
QueryOperators.__index = QueryOperators

local Predicates = {}
Predicates.__index = Predicates

local ExprOperators = {}
ExprOperators.__index = ExprOperators

--- Log debug message. Sends to response metadata if debugging is enabled
local function debug(msg)
    if isDebugging then
        responseMeta['debug'] = responseMeta['debug'] or {}
        table.insert(responseMeta["debug"], msg)
    end
end

--- https://lua.programmingpedia.net/en/tutorial/5829/pattern-matching
local IDENTIFIER_PATTERN = "[%a_]+[%a%d_]*"
local OPERATOR_NAME_PATTERN = "^$" .. IDENTIFIER_PATTERN

--- split key between prefix and last segment
local function splitKey(key)
    if type(key) ~= "string" then
        return "", nil
    end
    local last = key:match("([^:]+)$")
    if not last then
        return "", nil
    end
    local prefix = key:sub(1, #key - #last)
    return prefix, last
end

-- Check whether the given name passes for an operator. We assume any field name
-- starting with '$' is an operator. This is cheap and safe to do since keys beginning
-- with '$' should be reserved for internal use.
-- @param {String} name
local function isOperator(name)
    return string.match(name, OPERATOR_NAME_PATTERN) ~= nil
end

local function isString(val)
    return type(val) == 'string'
end

local function isNil(val)
    return val == cjson.null or val == nil
end

local function isNumber(val)
    return type(val) == 'number'
end

local function isBoolean(val)
    return type(val) == 'boolean'
end

local function isFunction(val)
    return type(val) == 'function'
end

local function isTable(val)
    return type(val) == 'table'
end

local function inArray(arr, value)
    for _, v in ipairs(arr) do
        if v == value then
            return true
        end
    end
    return false
end

local function isObject(val)
    return type(val) == 'table'
end

local function isArray(t)
    if (type(t) ~= 'table') then
        return false
    end
    local i = 0
    for _ in pairs(t) do
        i = i + 1
        -- note: explicitly check against nil here !!!
        -- for arrays coming from JSON, we can have cjson.null, which we
        -- want to support
        if t[i] == nil then
            return false
        end
    end
    return true
end

local function isEqual(o1, o2)
    local ty1 = type(o1)
    local ty2 = type(o2)
    if ty1 ~= ty2 then
        -- special case handling of nil
        -- https://docs.mongodb.com/manual/tutorial/query-for-null-fields/
        if (isNil(o1) and isNil(o2)) then
            return true
        end
        return false
    end

    -- non-table types can be directly compared
    if ty1 ~= 'table' then
        return o1 == o2
    end

    for k1, v1 in pairs(o1) do
        local v2 = o2[k1]
        if isNil(v2) or not isEqual(v1, v2) then
            return false
        end
    end
    for k2, _ in pairs(o2) do
        local v1 = o1[k2]
        if isNil(v1) then
            return false
        end
    end
    return true
end

local function getType(val)
    if (val == cjson.null) then
        return JsType.NULL
    end
    local t = type(val)
    if (t == 'table') then
        return isArray(val) and JsType.ARRAY or JsType.OBJECT
    end
    return t
end

local function ensureArray(x)
    return isArray(x) and x or { x }
end

local function map(arr, fn)
    local res = {}
    for i, val in ipairs(arr) do
        res[i] = fn(val)
    end
    return res
end

local function some(arr, fn)
    if not isTable(arr) then
        return fn(arr)
    end
    for _, val in ipairs(arr) do
        if (fn(val)) then
            return true
        end
    end
    return false
end

local function every(arr, fn)
    if not isTable(arr) then
        return fn(arr)
    end
    for _, val in ipairs(arr) do
        if (not fn(val)) then return false end
    end
    return true
end

local function keys(obj)
    local res = {}
    for k, _ in pairs(obj) do
        res[#res + 1] = k
    end
    return res
end

local function startsWith(haystack, needle)
    return isString(haystack) and
        isString(needle) and
        string.sub(haystack, 1, #needle) == needle
end

local function stringContains(haystack, needle)
    -- Escape all pattern magic characters to treat needle literally
    local escaped = needle:gsub("([%(%)%.%%%+%-%*%?%[%^%$%]])", "%%%1")
    return string.find(haystack, escaped) ~= nil
end

local function constant(value)
    return function()
        return value
    end
end

---- Casting --------------------------------------------------

--- does a js compatible truthy check
local function isTruthy(value)
    -- Check falsy values by JS semantics
    if value == false or value == nil or value == cjson.null then
        return false
    end

    if value == 0 or value == "" then
        return false
    end

    local t = type(value)
    -- Check for NaN: NaN is not equal to itself in Lua and JS
    if t == "number" then
        if value ~= value then
            return false
        end
    elseif t == "table" then
        if next(value) == nil then
            return false
        end
    end
    -- Everything else is truthy
    return true
end

local function toBool(val, ...)
    local bool = false
    local t = type(val)
    if (t == "nil") then return false end
    if (val == true or val == false) then return val end
    if (t == "number") then return val ~= 0 end
    if (t == "string") then
        if (val == 'true' or val == "1") then return true end
        if (val == 'false' or val == "0") then return false end
        return #val > 0
    end
    if t == 'function' then
        bool = bool(val(...))
    end
    return bool
end

local function xor(a, b)
    a = isTruthy(a)
    b = isTruthy(b)
    return a ~= b
end

local dblQuote = function(v)
    return '"' .. v .. '"'
end

local function tostr(value, ...)
    local str = '';
    local t = type(value)
    -- local v;
    if (t == 'string') then
        return value
    elseif (t == 'boolean') then
        return (value and 'true' or 'false')
    elseif isNil(value) then
        return 'nil'
    elseif (t == 'number') then
        return value .. ''
    elseif (t == 'function') then
        return tostr(value(...))
    elseif (t == 'table') then
        local delims = { '{', '}' }
        if isArray(value) then
            delims = { '[', ']' }
        end
        str = delims[1]
        for k, v in pairs(value) do
            v = isString(v) and dblQuote(v) or tostr(v, ...)
            if isNumber(k) then
                str = str .. v .. ', '
            else
                str = str .. dblQuote(k) .. ': ' .. v .. ', '
            end
        end
        str = str:sub(0, #str - 2) .. delims[2]
    end
    return str
end

-- raw value should be a kv table [name, value, name, value ...]
-- convert to an associative array
local function to_hash(value)
    local len, result = #value, {}
    for k = 1, len, 2 do
        result[value[k]] = value[k + 1]
    end
    return result
end

local function simpleResolve(value, key)
    if type(value) == "table" then
        local v = value[key]
        if v ~= nil then
            return v
        end
    end
    return cjson.null
end

--[[
Resolve the value of the field (dot separated) on the given object

@param obj {Object} the object context
@param selector {String} dot separated path to field
@param {ResolveOptions} options
@returns {function} a function which when called with an object returns the resolved field value
]]
local function resolve(obj, segments)
    local tonumber = tonumber

    -- Traverse through the table using the path segments
    local current = obj

    for _, segment in ipairs(segments) do
        if type(current) ~= "table" then
            return cjson.null
        end

        local num = tonumber(segment)
        -- Use numeric index if it's a valid positive integer
        if num and num >= 0 and math.floor(num) == num then
            -- convert 0-based index to 1-based
            current = current[num + 1]
        else
            current = current[segment]
        end

        debug("current after segment '" .. segment .. "': " .. tostr(current))
    end

    return current
end

-- Returns a predicate function that matches
-- *all* of the given predicate functions.
local function join_AND(predicates)
    if (#predicates == 1) then
        return predicates[1]
    end
    return function(s)
        local preds = predicates
        for _, func in ipairs(preds) do
            if not func(s) then return false end
        end
        return true
    end
end

-- Returns a predicate function that matches
-- *any* of the given predicate functions.
local function join_OR(predicates)
    if (#predicates == 1) then
        return predicates[1]
    end
    return function(s)
        local preds = predicates
        for _, func in ipairs(preds) do
            if func(s) then return true end
        end
        return false
    end
end

-- intersect arrays (not hashes)
local function intersection(first, second)
    local t = {}
    local len = 0
    local dedup = {}
    for _, v in ipairs(first) do
        if inArray(second, v) and not dedup[v] then
            len = len + 1
            t[len] = v
            dedup[v] = true
        end
    end
    return t
end

---- PREDICATES ------------------------------------------------------------------------

local function compare(a, b, fn)
    local btype = type(b)
    return some(a, function(x)
        return (btype == type(x)) and fn(x, b)
    end)
end

Predicates['$eq'] = function(a, b)
    -- start with simple equality check
    if (isEqual(a, b)) then
        return true
    end

    -- check
    if (isArray(a)) then
        return some(a, function(val)
            return isEqual(val, b)
        end)
    end

    return false
end

Predicates['$ne'] = function(a, b)
    return not Predicates['$eq'](a, b)
end

Predicates['$in'] = function(a, b)
    -- assert(isArray(b), '')
    -- queries for null should be able to find undefined fields
    if (isNil(a)) then
        return some(b, isNil)
    end
    return some(a, function(v)
        return inArray(b, v)
    end)
end

Predicates['$nin'] = function(a, b)
    return not Predicates['$in'](a, b)
end

Predicates['$lt'] = function(a, b)
    return compare(a, b, function(x, y) return x < y end)
end

Predicates['$lte'] = function(a, b)
    return compare(a, b, function(x, y) return x <= y end)
end

Predicates['$gt'] = function(a, b)
    return compare(a, b, function(x, y) return x > y end)
end

Predicates['$gte'] = function(a, b)
    return compare(a, b, function(x, y) return x >= y end)
end

Predicates['$contains'] = function(haystack, pattern)
    local t = type(haystack)
    if t ~= "string" then
        haystack = tostring(haystack)
    end
    return some(pattern, function(pat)
        return stringContains(haystack, pat)
    end)
end

--[[
Compile a regex pattern into a predicate function.

@param pattern {String|Array} the regex pattern/array of patterns
@param ignoreCase {Boolean} ignore case when matching
@returns {Function} the compiled predicate function
]]
local function compileRegex(pattern, ignoreCase)
    local function stringMatch(haystack, needle)
        return isString(haystack) and string.match(haystack, needle) ~= nil
    end

    local function isMatch(haystack, needle)
        debug("Regex matching haystack: " .. tostr(haystack) .. " with needle: " .. tostr(needle))
        local t = type(haystack)
        if t == "string" then
            return stringMatch(haystack, needle)
        end
        if t == "table" then
            local matchFn = stringMatch
            return some(haystack, function(val) return matchFn(val, needle) end)
        end
        return false
    end

    local function isMatchInsensitive(haystack, needle)
        if not isString(haystack) then
            return false
        end
        haystack = string.lower(haystack)
        needle = string.lower(needle)
        return string.match(haystack, needle) ~= nil
    end

    local t = type(pattern)
    if ignoreCase then
        if t == "string" then
            pattern = string.lower(pattern)
            return function(val)
                return some(val, function(v)
                    local compareTo = pattern
                    local isString = isString
                    return isString(v) and string.find(string.lower(v), compareTo) ~= nil
                end)
            end
        end
        if t == "table" then
            return function(val)
                local compareTo = pattern
                local some = some
                local isMatchInsensitive = isMatchInsensitive
                return some(compareTo, function(pat) return isMatchInsensitive(val, pat) end)
            end
        end
    else
        if t == "string" then
            return function(val)
                local compareTo = pattern
                local isMatch = isMatch
                return isMatch(val, compareTo)
            end
        end
        if t == "table" then
            return function(val)
                local compareTo = pattern
                local isMatch = isMatch
                return some(compareTo, function(pat) return isMatch(val, pat) end)
            end
        end
    end
    error("$regex: invalid pattern type: " .. t)
end

-- Compile a contains pattern into a predicate function.
--
-- This differs from compileRegex in that it does non-regex matches, i.e. it escapes pattern meta-characters
-- before matching
local function compileContains(pattern, ignoreCase)
    local t = type(pattern)
    if ignoreCase then
        local needle = string.lower(pattern)
        if t == "string" then
            return function(haystack)
                local compareTo = needle

                return some(compareTo, function(pat)
                    local contains = stringContains
                    local isString = isString

                    if not isString(haystack) then
                        return false
                    end
                    return contains(string.lower(haystack), pat)
                end)
            end
        end
        if t == "table" then
            return function(haystack)
                local compareTo = needle

                return some(compareTo, function(pat)
                    local isString = isString
                    local contains = stringContains

                    if not isString(haystack) then
                        return false
                    end
                    return contains(string.lower(haystack), string.lower(pat))
                end)
            end
        end
    else
        if t == "string" then
            return function(val)
                local compareTo = pattern
                local contains = stringContains
                return contains(val, compareTo)
            end
        end
        if t == "table" then
            return function(val)
                local compareTo = pattern
                some(compareTo, function(pat)
                    local contains = stringContains
                    return contains(val, pat)
                end)
            end
        end
    end
    error("$contains: invalid pattern type: " .. t)
end

local function matchRegex(haystack, needle, ignoreCase)
    local matchFn = compileRegex(needle, ignoreCase)
    return matchFn(haystack)
end

Predicates['$regex'] = function(haystack, needle)
    return matchRegex(haystack, needle, false)
end

Predicates['$iregex'] = function(haystack, needle)
    return matchRegex(haystack, needle, true)
end

-- Matches arrays that contain all elements specified in the query.
Predicates['$all'] = function(a, b)
    if (isArray(a) and isArray(b)) then
        -- order of arguments matter
        local int = intersection(b, a)
        return #b == #int
    end
    return false
end

Predicates['$exists'] = function(a, b)
    local non_existent = false
    if a == cjson.null or a == nil then
        non_existent = true
    elseif type(a) == "table" then
        -- for tables, we consider non-existent only if the table is empty
        non_existent = next(a) == nil
    end
    local v = isTruthy(b)
    return
        ((v == false) and non_existent) or
        (v and (not non_existent))
end

Predicates['$startsWith'] = function(haystack, needle)
    return startsWith(haystack, needle)
end

Predicates['$endsWith'] = function(haystack, needle)
    if (not isString(haystack) or not isString(needle)) then return false end
    return needle == '' or string.sub(haystack, -string.len(needle)) == needle
end

Predicates['$type'] = function(a, b)
    local types = ensureArray(b)
    for _, t in ipairs(types) do
        if (t == JsType.NUMBER) then
            return isNumber(a)
        elseif (t == JsType.OBJECT) then
            return isObject(a) and not isArray(a)
        elseif (t == JsType.STRING) then
            return isString(a)
        elseif (t == JsType.ARRAY) then
            return isArray(a)
        elseif (t == JsType.NULL or t == 'null') then
            return isNil(a)
        elseif (t == JsType.BOOLEAN) then
            return isBoolean(a)
        end
    end
    return false
end

Predicates['$size'] = function(a, b)
    return isArray(a) and isNumber(b) and #a == b
end

---- QUERY OPERATORS -------------------------------------------------------------------

-- Simplify expression for easy evaluation with query operators map
-- @param expr
-- @returns {*}
local function normalize(expr)
    -- normalized primitives
    local t = getType(expr)
    if (JS_SIMPLE_TYPES[t]) then
        return { ['$eq'] = expr }
    end

    -- normalize object expression
    if (isObject(expr)) then
        for k, v in pairs(expr) do
            t = type(v)
            if not isOperator(k) then  -- skip something like { $gt: null }
               expr[k] = normalize(v)
            end
        end
    end

    return expr
end

--[[
Compile the given query criteria into a predicate function. The function returns true
if the given job object matches the criteria, false otherwise.

@param {Object} criteria the query criteria
@returns {Function} the compiled predicate function
]]
local function compileQuery(criteria)
    assert(type(criteria) == 'table', 'query criteria must be an object')

    local compiled = {}

    local function processOperator(field, operator, value)
        local operatorFn = QueryOperators[operator]
        assert(operatorFn ~= nil,
            'invalid op: "' .. operator .. '" - (field: ' .. field .. ", value: " .. tostr(value) .. ")");
        compiled[#compiled + 1] = operatorFn(field, value)
    end

    local function parse2(field, expr)
        local compiled = {}
        local t = type(expr)
        local fieldResolver = getFieldResolver(field)

        if JS_SIMPLE_TYPES[t] then
            -- $eq operator for primitive values
            if isNil(expr) then
                return function(obj)
                    local resolve = fieldResolver
                    local lhs = resolve(obj)
                    return isNil(lhs)
                end
            else
                return function(obj)
                    local resolve = fieldResolver
                    local lhs = resolve(obj)
                    return lhs == expr
                end
            end
        end
        -- see if all keys are operators, IOW, something like { $gt: value, $lt: value }
        local predicateFn = constant(false)

        for key, val in pairs(expr) do
            if isOperator(key) then
                --- something like { $gt: value }. Transform to field:{ $gt: value } and process
                local newValue = { [key] = val }
                local newExpr = { [field] = newValue }
                predicateFn = compileQuery(newExpr)
            else
                local subField = field .. '.' .. key
                debug("Processing subfield '" .. subField .. "' with value: " .. tostr(val))
                predicateFn = parse2(subField, val)
            end
            compiled[#compiled+1] = predicateFn
        end

        return join_AND(compiled)
    end

    local function parse(crit)
        for field, expr in pairs(criteria) do
            if (field == '$and' or
                field == '$or' or
                field == '$nor' or
                field == '$expr' or
                field == '$xor') then
                processOperator(field, field, expr)
            elseif field == '$not' then
                assert(isObject(expr),
                    '$not operator requires an object expression for field: ' .. field)
                local predicateFn = compileQuery(expr)
                local fn = function(obj)
                    --- capture locally to avoid upvalue lookups
                    local predicate = predicateFn
                    return not predicate(obj)
                end
                table.insert(compiled, fn)
            else
                --- normalize expression
                local expr1 = normalize(expr)

                for op, val in pairs(expr1) do
                    if isOperator(op) then
                        processOperator(field, op, val)
                    else
                        -- something like { field: { subfield: value } }
                        local pred = parse2(field, val)
                        table.insert(compiled, pred)
                    end
                end
            end
        end

        assert(#compiled > 0, 'empty criteria: ' .. tostr(crit))
        return join_AND(compiled)
    end

    return parse(criteria)
end

QueryOperators['$xor'] = function(_selector, value)
    assert(isArray(value) and #value == 2,
        'Invalid expression. $xor expects value to be an array with 2 items')
    local leftFn = compileQuery(value[1])
    local rightFn = compileQuery(value[2])

    return function(obj)
        --- capture locally to avoid upvalue lookups
        local left = leftFn
        local right = rightFn
        return xor(left(obj), right(obj))
    end
end

QueryOperators['$or'] = function(_selector, value)
    assert(isArray(value),
        'Invalid expression. $or expects value to be an Array')

    local queries = map(value, compileQuery)

    return join_OR(queries)
end

QueryOperators['$and'] = function(_selector, value)
    assert(isArray(value),
        'Invalid expression: $and expects value to be an Array')

    local queries = map(value, compileQuery)
    return join_AND(queries)
end

QueryOperators['$nor'] = function(_selector, value)
    local fn = QueryOperators['$or']('$or', value);
    return function(obj)
        return not fn(obj)
    end
end

QueryOperators['$not'] = function(selector, value)
    local criteria = {}
    criteria[selector] = normalize(value)
    local fn = compileQuery(criteria)
    return function(obj)
        local predicate = fn
        return not predicate(obj)
    end
end

QueryOperators['$regex'] = function(selector, value)
    local pattern = value
    local ignoreCase = false

    local t = type(value)
    assert(t == "string" or t == "table", '$regex: pattern should be a string or array of strings')

    if t == "table" then
        --- could be a list of patterns, e.g. { $regex: [ "err", "fail" ] },
        --- or could be an object with $pattern and $options, e.g. { $regex: { $pattern: "err", $options: "i" } }
        local pat = value["$pattern"]
        if pat ~= nil then
            pattern = pat
            local options = value["$options"]
            if options ~= nil and isString(options) then
                ignoreCase = string.find(options, "i") ~= nil
            end
        end
    end

    local resolveFn = getFieldResolver(selector)
    local predicateFn = compileRegex(pattern, ignoreCase)

    return function(obj)
        local resolve = resolveFn
        local predicate = predicateFn

        local lhs = resolve(obj)
        return predicate(lhs)
    end
end

QueryOperators['$contains'] = function(selector, value)
    local resolveFn = getFieldResolver(selector)
    local predicateFn = compileContains(value, false)

    return function(obj)
        -- capture values locally to avoid upvalue lookups
        local resolve = resolveFn
        local predicate = predicateFn

        local lhs = resolve(obj)
        return predicate(lhs)
    end
end

QueryOperators['$icontains'] = function(selector, value)
    local resolveFn = getFieldResolver(selector)
    local predicateFn = compileContains(value, true)

    return function(obj)
        -- capture values locally to avoid upvalue lookups
        local resolve = resolveFn
        local predicate = predicateFn

        local lhs = resolve(obj)
        return predicate(lhs)
    end
end

QueryOperators['$eq'] = function(selector, value)
    local resolveFn = getFieldResolver(selector)
    if isNil(value) then
        return function(obj)
            -- capture values locally to avoid upvalue lookups
            local resolve = resolveFn
            local lhs = resolve(obj)
            return isNil(lhs)
        end
    end
    local t = type(value)
    if JS_SIMPLE_TYPES[t] then
        return function(obj)
            -- capture values locally to avoid upvalue lookups
            local resolve = resolveFn
            local lhs = resolve(obj)
            return lhs == value
        end
    end
    return function(obj)
        -- capture values locally to avoid upvalue lookups
        local resolve = resolveFn
        local lhs = resolve(obj)
        return isEqual(lhs, value)
    end
end

local function split(str, sep)
    local sep, fields = sep or ".", {}
    local pattern = string.format("([^%s]+)", sep)
    str:gsub(pattern, function(c)
        fields[#fields + 1] = c
    end)
    return fields
end

local fieldHandlers = {}
local referencedFields = {}

local function clearCachedValues()
    cachedValues = {}
end

local function getJobFullText(obj)
    local values = {}
    for _, key in ipairs(FULL_TEXT_FIELDS) do
        local value = obj[key]
        if value ~= nil then
            values[#values + 1] = value
        end
    end
    return table.concat(values, "")
end

local function resolveFullText(obj)
    local text = cachedValues["fullText"]
    if text == nil then
        text = getJobFullText(obj)
        cachedValues["fullText"] = text
    end
    return text
end

local function resolveLogs()
    local logKey = currentJobKey .. ":logs"
    local logs = cachedValues[logKey]
    if logs ~= nil then
        return logs
    end
    logs = ""
    local lines = rcall("LRANGE", logKey, 0, -1)
    if lines ~= nil and #lines > 0 then
        for _, line in ipairs(lines) do
            if line ~= nil then
                logs = logs .. line
            end
        end
    end
    cachedValues[logKey] = logs
    return logs
end

local function resolveFullTextAndLogs(obj)
    local text = resolveFullText(obj)
    local logs = resolveLogs() or ""
    if #logs > 0 then
        text = text .. logs
    end
    return text
end

local function latencyResolver(obj)
    local processedOn = tonumber(obj['processedOn'])
    local finishedOn = tonumber(obj['finishedOn'])
    if (isNumber(processedOn) and isNumber(finishedOn)) then
        return finishedOn - processedOn
    end
    return nil
end

local function waitTimeResolver(obj)
    local processedOn = tonumber(obj['processedOn'])
    local timestamp = tonumber(obj['timestamp'] or processedOn)
    if (processedOn ~= nil) and (timestamp ~= nil) then
        return processedOn - timestamp
    end
    return nil
end

-- the total time a job spent in the queue (processedOn - timestamp)
local function queueTimeResolver(obj)
    local processedOn = tonumber(obj['processedOn'])
    local timestamp = tonumber(obj['timestamp'] or processedOn)
    if (processedOn ~= nil) and (timestamp ~= nil) then
        return processedOn - timestamp
    end
    return nil
end

getFieldResolver = function(field)
    local handler = fieldHandlers[field]
    if (handler == nil) then
        local path = split(field, '.')
        local segmentCount = #path
        local segment = segmentCount > 0 and path[1] or field
        referencedFields[segment] = true

        if (segment == 'runtime') then
            handler = latencyResolver
        elseif segment == 'waitTime' then
            handler = waitTimeResolver
        elseif segment == 'queueTime' then
            handler = queueTimeResolver
        elseif segment == 'logs' then
            handler = resolveLogs
        elseif segment == 'fullText' then
            handler = resolveFullTextAndLogs
        else
            if segmentCount == 1 then
                -- Simple field access
                -- handle field aliases
                segment = FIELD_ALIASES[segment] or segment

                if NUMERIC_FIELDS[segment] then
                    handler = function(obj)
                        local resolve = simpleResolve
                        local path = segment
                        local val = resolve(obj, path)
                        return tonumber(val) or cjson.null
                    end
                else
                    handler = function(obj)
                        local resolve = simpleResolve
                        local path = segment
                        return resolve(obj, path)
                    end
                end
            else
                handler = function(obj)
                    local resolve = resolve
                    local lpath = path
                    local val = resolve(obj, lpath)
                    debug('Resolved field "' .. field .. '" to value: ' .. tostr(val))
                    return val
                end
            end
        end
    end
    fieldHandlers[field] = handler
    return handler
end

--- EXPRESSION OPERATORS -------------------------------------------------------------

-- Parses an expression and returns a function which returns
-- the actual value of the expression using a given object as context
--
-- @param {table} expr the expression for the given field
-- @param {string} operator the operator to resolve the field with
-- @returns {function}
--
local function parseExpression(expr, operator)

    local function parseArray()
        local compiledFn = map(expr, parseExpression)
        return function(obj)
            local compiled = compiledFn
            local result = map(compiled, function(fn)
                local v = fn(obj)
                return (v == nil) and cjson.null or v
            end)
            return result
        end
    end

    local function parseObject()
        local compiled = {}
        for key, val in pairs(expr) do
            compiled[key] = parseExpression(val, key)
            -- must run ONLY one aggregate operator per expression
            -- if so, return result of the computed value
            if (ExprOperators[key] ~= nil) then
                -- there should be only one operator
                local _keys = keys(expr)
                -- debug('key: ' .. key.. ', Keys: ' .. tostr(_keys))
                assert(#_keys == 1, 'Invalid aggregation expression "' .. tostr(expr) .. '".')
                compiled = compiled[_keys[1]]
            end
        end

        if (isFunction(compiled)) then
            return compiled
        end

        return function(obj)
            local compiledList = compiled

            local result = {}
            for key, fn in pairs(compiledList) do
                local v = fn(obj)
                result[key] = (v == nil) and cjson.null or v
            end
            return result
        end
    end

    -- if the field of the object is a valid operator
    if (operator and ExprOperators[operator] ~= nil) then
        return ExprOperators[operator](expr);
    end

    -- if expr is a variable for an object field
    if (isString(expr) and #expr > 1 and expr:sub(1, 1) == '$') then
        local field = expr:sub(2)
        return getFieldResolver(field)
    end

    if type(expr) == 'table' then
        if (isArray(expr)) then
            return parseArray()
        else
            return parseObject()
        end
    else
        return function()
            return expr
        end
    end
end

--
-- Allows the use of aggregation expressions within the query language.
--
-- @param selector
-- @param value
-- @returns {Function}
--
QueryOperators['$expr'] = function(_selector, value)
    return parseExpression(value)
end

--------------- Conditional Operators --------------------------------------------------------------

ExprOperators['$ifNull'] = function(expr)
    assert(isArray(expr) and #expr == 2,
        '$ifNull expression must resolve to array(2)')
    local exec = parseExpression(expr);
    return function(obj)
        local args = exec(obj);
        return isNil(args[1]) and args[2] or args[1]
    end
end

ExprOperators['$cond'] = function(expr)
    local ifExpr, thenExpr, elseExpr
    local errorMsg = '$cond: invalid arguments'
    if (isArray(expr)) then
        assert(#expr == 3, errorMsg)
        ifExpr = expr[1]
        thenExpr = expr[2]
        elseExpr = expr[3]
    else
        assert(isObject(expr), errorMsg);
        ifExpr = expr['if']
        thenExpr = expr['then']
        elseExpr = expr['else']
    end

    assert(ifExpr, '$cond: missing if condition')
    assert(thenExpr, '$cond: missing else')

    ifExpr = parseExpression(ifExpr)
    thenExpr = parseExpression(thenExpr)
    elseExpr = elseExpr and parseExpression(elseExpr) or constant(nil)

    return function(obj)
        local condition = toBool(ifExpr(obj))
        return condition and thenExpr(obj) or elseExpr(obj)
    end
end

----------------------------------------------------------------------------------------------------

ExprOperators['$and'] = function(expr)
    local compute = parseExpression(expr)
    return function(obj)
        local args = compute(obj)
        return every(args, isTruthy)
    end
end

ExprOperators['$or'] = function(expr)
    local exec = parseExpression(expr)
    return function(obj)
        local args = exec(obj)
        return some(args, isTruthy)
    end
end

ExprOperators['$xor'] = function(expr)
    local exec = parseExpression(expr)
    return function(obj)
        local args = ensureArray(exec(obj))
        local truthyCount = 0
        for _, v in ipairs(args) do
            if isTruthy(v) then
                truthyCount = truthyCount + 1
                if truthyCount > 1 then
                    return false
                end
            end
        end
        return truthyCount == 1
    end
end

ExprOperators['$not'] = function(expr)
    local exec = parseExpression(expr)
    -- todo: make sure its a single value
    return function(obj)
        local value = exec(obj)
        return not isTruthy(value)
    end
end

ExprOperators['$literal'] = function(expr)
    return constant(expr)
end

ExprOperators['$in'] = function(expr)
    local exec = parseExpression(expr)

    return function(obj)
        local args = exec(obj)
        assert(isArray(args) and #args == 2, '$in expects an array(2)')
        local val = args[1]
        local arr = args[2]
        assert(isArray(arr), '$in second argument must be an array')
        return some(arr, function(x)
            return isEqual(x, val)
        end)
    end
end

ExprOperators['$nin'] = function(expr)
    local pred = ExprOperators['$in'](expr);
    return function(obj)
        return not pred(obj)
    end
end

ExprOperators['$between'] = function(expr)
    local exec = parseExpression(expr)

    return function(obj)
        local args = exec(obj)
        assert(isArray(args) and #args == 2, '$between expects an array(2)')
        local val = args[1]
        local arr = args[2]
        assert(isArray(arr), '$between second argument must be an array')

        local lower, upper = arr[1], arr[2]
        return val >= lower or val <= upper
    end
end

ExprOperators['$cmp'] = function(expr)
    local exec = parseExpression(expr)

    return function(obj)
        local args = exec(obj)
        assert(isArray(args) and #args == 2, '$cmp expects an array of 2 arguments')
        local a, b = args[1], args[2]
        local ta, tb = type(a), type(b)
        if ta == tb then
            if ta == "string" or ta == "number" then
                if (a < b) then return -1 end
                if (a > b) then return 1 end
                return 0
            end
            if isNil(a) and isNil(b) then
                return 0
            end
        end
        error("$cmp expects two string or number operands")
    end
end

ExprOperators['$strcasecmp'] = function(expr)
    local exec = parseExpression(expr)

    return function(obj)
        local args = exec(obj)
        assert(isArray(args), '$strcasecmp must resolve to array(2)')
        if (isEqual(args[1], args[2])) then return 0 end
        assert(isString(args[1]) and isString(args[2]),
            '$strcasecmp must resolve to array(2) of strings')

        local a = args[1]:upper()
        local b = args[2]:upper()

        if (a > b) then return 1 end
        if (a < b) then return -1 end
        return 0
    end
end

-- s "sensible" toBool
ExprOperators['$toBool'] = function(expr)
    local exec = parseExpression(expr)
    return function(obj)
        local val = exec(obj)
        return toBool(val)
    end
end

ExprOperators['$toString'] = function(expr)
    local exec = parseExpression(expr)
    return function(obj)
        local value = exec(obj)
        return tostr(value)
    end
end

ExprOperators['$toNumber'] = function(expr)
    local exec = parseExpression(expr)
    return function(obj)
        local value = exec(obj)
        return tonumber(value) or cjson.null
    end
end

local function createComparison(name)
    local fn = Predicates[name]
    ExprOperators[name] = function(expr)
        local execFn = parseExpression(expr)
        return function(obj)
            local exec = execFn -- capture to spare an upvalue lookup
            local args = exec(obj)
            assert(isArray(args) and #args == 2, name .. ': comparison expects 2 arguments. Got ' .. tostr(args))
            local val = fn(args[1], args[2])
            if isDebugging then
                debug('Comparison: ' .. tostr(args[1]) .. ' ' .. name .. ' ' .. tostr(args[2]) .. ' = ' .. tostr(val))
            end
            return val
        end
    end
end

local function initOperators()
    for name, predicateFn in pairs(Predicates) do
        if QueryOperators[name] == nil then
            QueryOperators[name] = function(selector, value)
                local resolveFn = getFieldResolver(selector)

                return function(obj)
                    -- capture locally to avoid upvalue lookups
                    local resolve = resolveFn
                    local predicate = predicateFn

                    local lhs = resolve(obj)
                    local val = predicate(lhs, value)

                    if isDebugging then
                        debug('Predicate: ' .. tostr(lhs) .. ' ' .. name .. ' ' .. tostr(value) .. ' = ' .. tostr(val))
                    end

                    return val
                end
            end
        end
    end
    createComparison('$eq')
    createComparison('$gt')
    createComparison('$gte')
    createComparison('$lt')
    createComparison('$lte')
    createComparison('$ne')
    createComparison('$type')
    createComparison('$matches')
    createComparison('$startsWith')
    createComparison('$endsWith')
end

local function prepProgress(job)
    if referencedFields['progress'] then
        local success, num = pcall(tonumber, job['progress'])
        if success then
            job['progress'] = num
            -- todo: handle json
        end
    end
end

local function prepJsonField(job, name)
    if referencedFields[name] then
        local success, res = pcall(cjson.decode, job[name])
        if (success) then
            job[name] = res
        end
    end
end

local function prepareJobHash(id, jobHash)
    local job = to_hash(jobHash)
    -- on the client side, these are expected to be string, so save the value
    local data = job['data'] or "{}"
    local opts = job['opts']
    job['id'] = id
    prepJsonField(job, 'data')
    prepJsonField(job, 'opts')
    prepJsonField(job, 'stackTrace')
    prepProgress(job)
    return job, data, opts
end

local function getKeysForState(stateKey, status, rangeStart, rangeEnd, asc)
    local function getRangeInList(listKey)
        local len = rcall('LLEN', listKey)
        local items = {}

        if asc then
            local modifiedRangeStart
            local modifiedRangeEnd
            if rangeStart == -1 then
                modifiedRangeStart = 0
            else
                modifiedRangeStart = -(rangeStart + 1)
            end
            if rangeEnd == -1 then
                modifiedRangeEnd = 0
            else
                modifiedRangeEnd = -(rangeEnd + 1)
            end


            items = rcall("LRANGE", listKey, modifiedRangeEnd, modifiedRangeStart)
        else
            items = rcall("LRANGE", listKey, rangeStart, rangeEnd)
        end
        return items, len
    end

    if status == "wait" or status == "waiting" or status == "paused" then
        -- Markers in waitlist DEPRECATED in v5: Remove in v6.
        local marker = rcall("LINDEX", stateKey, -1)
        if marker and string.sub(marker, 1, 2) == "0:" then
            local count = rcall("LLEN", stateKey)
            if count > 1 then
                rcall("RPOP", stateKey)
                return getRangeInList(stateKey)
            else
                return 0, {}
            end
        else
            return getRangeInList(stateKey)
        end
    elseif status == "active" then
        return getRangeInList(stateKey)
    else
        local count = rcall('ZCARD', stateKey)
        local items = {}
        if asc then
            items = rcall("ZRANGE", stateKey, rangeStart, rangeEnd)
        else
            items = rcall("ZREVRANGE", stateKey, rangeStart, rangeEnd)
        end
        return items, count
    end
end

--[[ Cursor Management ------------------------------------------------------------]]
local function getCursorState()
    local temp = rcall("GET", cursorKey) or ''
    local success, meta = pcall(cjson.decode, temp)
    if not success then
        meta = {
            ['cursor'] = 0,
            ['total'] = 0,
            ['iteration'] = 0,
            ['progress'] = 0,
            ['done'] = true,
            ['found'] = false,
            ['jobCount'] = 0,
            ['jobs'] = {}
        }
    end
    return meta
end

-- attempt to read "count" jobs filtered fron previous iterations
local function getJobsFromCursor(count)
    local meta = getCursorState()
    local result = {}

    if count > 0 then
        local jobs = meta["jobs"] or "[]"
        local success, parsedJobs = pcall(cjson.decode, jobs)
        -- collect jobs from the stored list
        if success and isArray(parsedJobs) then
            local remainder = {}
            for i, job in ipairs(parsedJobs) do
                if i > count then
                    table.insert(remainder, job)
                else
                    table.insert(result, job)
                end
            end

            meta['jobs'] = remainder
            meta['jobCount'] = #remainder

            local serialized = cjson.encode(remainder)
            rcall("SET", cursorKey, serialized)
            -- set expirations
            rcall("EXPIRE", cursorKey, CURSOR_EXPIRATION)
        end
    end

    return result, meta
end

local function writeCursorMeta(cursor, iteration, progress, total, items)
    local jobCount = items ~= nil and #items or 0
    items = items or {}
    local metaKV = {
        ['cursor'] = cursor,
        ['progress'] = progress,
        ['total'] = total,
        ['iteration'] = tonumber(iteration or 0),
        ['jobCount'] = jobCount,
        ['jobs'] = items,
        ['done'] = (progress >= total)
    }
    local serialized = cjson.encode(metaKV)
    rcall("SET", cursorKey, serialized)
    -- set expirations
    rcall("EXPIRE", cursorKey, CURSOR_EXPIRATION)
end


--------[[ Main ]]--------
local function search(stateKey, criteria, count, asc)
    count = count or 100
    fieldHandlers = {}
    referencedFields = {}
    local found = 0

    --- cursor, total
    local result = { '{ "cursor" : 0, "total": 0, "done": true }' }

    local jobs, meta = getJobsFromCursor(count)
    local total = meta["total"]
    local cursor = meta["cursor"]
    local progress = meta["progress"]
    local iteration = (meta["iteration"] or 0) + 1

    -- debug("Here1: cursor=" .. cursor .. ", total=" .. total .. ", progress=" .. progress .. ", found=" .. found)

    responseMeta['total'] = total
    responseMeta['progress'] = progress

    if #jobs > 0 then
        found = #jobs

        for _, job in jobs do
            table.insert(result, job)
        end

        if found == count then
            responseMeta['done'] = total == progress
            ressponseMeta['remainder'] = meta['jobCount'] or 0
            result[1] = cjson.encode(responseMeta)
            return result
        end
    end

    initOperators()
    local predicate = compileQuery(criteria)
    local rangeStart = cursor
    local rangeEnd = cursor + batchSize - 1
    cursor = rangeEnd + 1

    local keyPrefix, status = splitKey(stateKey)

    local scannedJobIds, total = getKeysForState(stateKey, status, rangeStart, rangeEnd, asc)
    local scannedCount = #scannedJobIds

    local remainder = {}

    for _, jobId in pairs(scannedJobIds) do
        currentJobKey = keyPrefix .. jobId
        local jobHash = redis.pcall('HGETALL', currentJobKey)

        if (isObject(jobHash) and #jobHash) then
            clearCachedValues()

            local job, data, opts = prepareJobHash(jobId, jobHash)

            if (predicate(job)) then
                --- these are expected to be string on the caller side
                job['data'] = data
                job['opts'] = opts

                found = found + 1
                local success, serialized = pcall(cjson.encode, job)
                if success then
                    if found > count then
                        table.insert(remainder, serialized)
                    else
                        table.insert(result, serialized)
                    end
                end
            end
        end
    end

    local remCount = #remainder

    progress = math.min(progress + scannedCount, total)
    local done = ((scannedCount == 0) or (progress == total)) and (remCount == 0)

    writeCursorMeta(cursor, iteration, progress, total, remainder)

    responseMeta["total"] = total
    responseMeta['done'] = done
    responseMeta['iteration'] = iteration
    responseMeta['progress'] = progress
    responseMeta['remainder'] = remCount

    result[1] = cjson.encode(responseMeta)

    return result
end

return search(stateKey, criteria, count, asc)
