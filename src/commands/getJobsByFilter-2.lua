--[[
  Get Jobs by filter criteria. The criteria is specified as a Mongo query style JSON document

     Input:
        KEYS[1] key for jobs in a given status
        KEYS[2] key for cursor
        ARGV[1] filter criteria as a Mongo styled query as a json encoded string
        ARGV[2] count
        ARGV[3] asc

  The cursor mechanism is to allow iteration through the dataset with state stored on the server.
]]

local rcall = redis.call
local stateKey = ""
local cursorKey = ""
local CURSOR_EXPIRATION = 30 -- seconds

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
}

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

--- Even though Count is passed in, remember that we're filtering through all jobs in a particular state.
--- IOW, we can legitimately return 0 results in an iteration. To compensate, we iterate up to MAX_ITERATION
--- attempting to get up to Count results
local MAX_ITERATIONS = 40

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
  return type(val) == 'nil' or val == cjson.null
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
    if (t[i] == nil) then
      return false
    end
  end
  return true
end

local function isEqual(o1, o2, ignore_mt)
  local ty1 = type(o1)
  local ty2 = type(o2)
  if ty1 ~= ty2 then
    -- special case handling of nil
    if (isNil(o1) and isNil(o2)) then
      return true
    end
    return false
  end

  -- non-table types can be directly compared
  if ty1 ~= 'table' then
    return o1 == o2
  end

  -- as well as tables which have the metamethod __eq
  local mt = getmetatable(o1)
  if not ignore_mt and mt and mt.__eq then
    return o1 == o2
  end

  for k1, v1 in pairs(o1) do
    local v2 = o2[k1]
    if isNil(v2) or not isEqual(v1, v2, ignore_mt) then
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

local function some(arr, fn)
  if not isArray(arr) then
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
  if not isArray(arr) then
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

local function slice(array, start, stop)
  start = start or 1
  stop = stop or #array
  local t = {}
  for i = start, stop do
    t[i - start + 1] = array[i]
  end
  return t
end

local function startsWith(haystack, needle)
  return isString(haystack) and
          isString(needle) and
          string.sub(haystack, 1, #needle) == needle
end
---- Casting --------------------------------------------------

local function toBool(val, ...)
    local bool = false
    local t = type(val)
    if (t == "nil") then return false end
    if (val == true or val == false) then return val end
    if (t == "number") then return val ~= 0 end
    if (t == "string") then
      if (val == 'true') then return true end
      if (val == 'false') then return false end
      return #val > 0
    end
    if t == 'function' then
        bool = bool(val(...))
    end
    return bool
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

local function debug(msg)
  redis.call('rpush', 'search-debug', tostr(msg))
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

--
-- Resolve the value of the field (dot separated) on the given object
-- @param obj {Object} the object context
-- @param selector {String} dot separated path to field
-- @param {ResolveOptions} options
-- @returns {*}
--
local function resolve(obj, segments, unwrapArray)
  local depth = 0

  --
  -- Unwrap a single element array to specified depth
  -- @param {Array} arr
  -- @param {Number} depth
  --
  local function unwrap(arr, unwrapDepth)
    if (unwrapDepth < 1) then
      return arr
    end
    while (unwrapDepth > 0 and #arr == 1) do
      arr = arr[1]
      unwrapDepth = unwrapDepth - 1
    end
    return arr
  end

  local function resolve2(o, path)
    local value = o
    local index = 1
    -- debug('resolving path ' .. tostr(path) .. ' in object ' .. tostr(o))

    while (index <= #path) do
      local field = path[index]

      if (type(value) == 'table') then
        local numIndex = tonumber(field)

        if (isArray(value)) then
          -- handle instances like
          -- value: { grades: [ { score: 10, max: 100 }, { score:5, max: 10 } ] }
          -- path: 'score'
          if (numIndex == nil) then
            -- On the first iteration, we check if we received a stop flag.
            -- If so, we stop to prevent iterating over a nested array value
            -- on consecutive object keys in the selector.
            if (index == 1 and depth > 0) then
              break
            end
            depth = depth + 1

            path = slice(path, index)
            local acc = {}
            for _, item in ipairs(value) do
              local v = resolve2(item, path)
              if not isNil(v) then
                acc[#acc + 1] = v
              end
            end
            value = acc
            break
          else
            field = (numIndex + 1)
          end
        end
        value = value[field]
      else
        value = nil
      end

      -- debug(field .. ':' .. tostr(value) .. ', ' .. tostr(index) .. '/' .. tostr(#path))

      index = index + 1
      if isNil(value) then
        break
      end
    end
    return value
  end

  local t = type(obj)
  if (t == 'table') then
    obj = resolve2(obj, segments, 1)
    if (unwrapArray) then
      obj = unwrap(obj, depth)
    end
  end

  return obj
end

-- Returns a predicate function that matches
-- *all* of the given predicate functions.
local function join_AND(predicates)
  if (#predicates == 1) then
    return predicates[1]
  end
  return function(s)
    for _, func in ipairs(predicates) do
      if not func(s) then
        return false
      end
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
    for _, func in ipairs(predicates) do
      if func(s) then return true end
    end
    return false
  end
end

local function constant(value)
  return function()
    return value
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
local Predicates = {}
Predicates.__index = Predicates

local function compare(a, b, fn)
  local btype = type(b)
  return some(a, function(x)
    return (btype == type(x)) and fn(x, b)
  end)
end

Predicates['$eq'] = function(a, b)
  -- https://docs.mongodb.com/manual/tutorial/query-for-null-fields/
  if (isNil(a) and isNil(b)) then
    return true
  end

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
  a = ensureArray(a)
  for _, v in ipairs(a) do
    if inArray(b, v) then
      return true
    end
  end
  return false
end

Predicates['$nin'] = function(a, b)
  return not Predicates['$in'](a, b)
end

Predicates['$lt'] = function(a, b)
  return compare(a, b, function(x, y)
    return x < y
  end)
end

Predicates['$lte'] = function(a, b)
  return compare(a, b, function(x, y)
    return x <= y
  end)
end

Predicates['$gt'] = function(a, b)
  return compare(a, b, function(x, y)
    return x > y
  end)
end

Predicates['$gte'] = function(a, b)
  return compare(a, b, function(x, y)
    return x >= y
  end)
end

Predicates['$contains'] = function(a, pattern)
    assert(isString(pattern), '$contains: needle should be a string')
    local arr = ensureArray(a)

    local function isMatch(x)
        return (isString(x)) and string.find(x, pattern)
    end

    return some(arr, function(x)
        if (isMatch(x)) then return true end
        if (type(x) == 'table') then
            for _, str in ipairs(x) do
                if isMatch(str) then return true end
            end
        end
        return false
    end)
end

Predicates['$regex'] = function(a, pattern)
    assert(isString(pattern), '$matches: pattern should be a string')

    local function isMatch(x)
        return (isString(x)) and x:match(pattern)
    end

    return some(a, function(x)
        if (isMatch(x)) then return true end
        if (type(x) == 'table') then
            for _, str in ipairs(x) do
                if isMatch(str) then return true end
            end
        end
        return false
    end)
end

Predicates['$matches'] = function(a, pattern)
    return Predicates['$regex'](a, pattern)
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
  local non_existent = isNil(a)
  return
  ((b == false or b == 0) and non_existent) or
          ((b == true or b == 1) and (not non_existent))
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
--
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

    local hasOperator = false
    for k, _ in pairs(expr) do
      if (isOperator(k)) then
        hasOperator = true
        break
      end
    end

    -- no valid query operator found, so we do simple comparison
    if (not hasOperator) then
      return { ['$eq'] = expr }
    end

  end

  return expr
end

local QueryOperators = {}
QueryOperators.__index = QueryOperators

local function compileQuery(criteria)
  assert(type(criteria) == 'table', 'query criteria must be an object')

  local compiled = {}

  local function processOperator(field, operator, value)
    local operatorFn = QueryOperators[operator]
    assert(operatorFn ~= nil, 'invalid query operator "' .. operator .. '" found');
    compiled[#compiled + 1] = operatorFn(field, value)
  end

  local function parse(crit)
    for field, expr in pairs(criteria) do

      if (field == '$and' or field == '$or' or field == '$nor' or field == '$expr') then
        processOperator(field, field, expr)
      else
        --- normalize expression
        local expr1 = normalize(expr)

        for op, val in pairs(expr1) do
          assert(isOperator(op), 'unknown top level operator: "' .. op .. '"')
          processOperator(field, op, val)
        end
      end

    end

    assert(#compiled > 0, 'empty criteria: ' .. tostr(crit))
    return join_AND(compiled)
  end

  return parse(criteria)
end

QueryOperators['$or'] = function(_selector, value)
  assert(isArray(value),
          'Invalid expression. $or expects value to be an Array')

  local queries = {}
  for _, expr in ipairs(value) do
    queries[#queries + 1] = compileQuery(expr)
  end

  return join_OR(queries)
end

QueryOperators['$and'] = function(_selector, value)
  assert(isArray(value),
          'Invalid expression: $and expects value to be an Array')

  local queries = {}
  for _, expr in ipairs(value) do
    queries[#queries + 1] = compileQuery(expr)
  end

  return join_AND(queries)
end

QueryOperators['$nor'] = function(selector, value)
  local fn = QueryOperators['$or']('$or', value);
  return function(obj)
    return not fn(obj)
  end
end

QueryOperators['$not'] = function(selector, value)
  local criteria = {}
  criteria[selector] = normalize(value)
  local predicate = compileQuery(criteria)
  return function(obj)
    return not predicate(obj)
  end
end

local function split (str, sep)
  local sep, fields = sep or ".", {}
  local pattern = string.format("([^%s]+)", sep)
  str:gsub(pattern, function(c)
    fields[#fields + 1] = c
  end)
  return fields
end

local fieldHandlers = {}
local referencedFields = {}
local cachedValues = {}

local function clearCachedValues()
    cachedValues = {}
end

local function getJobFullText(obj)
    local values = {}
    for i = 1, #FULL_TEXT_FIELDS, 1 do
        local key = FULL_TEXT_FIELDS[i]
        local value = obj[key]
        if value ~= nil then
            values[#values + 1] = value
        end
    end
    return table.concat(values, "|")
end


local function resolveFullText(obj)
    local text = cachedValues["$text"]
    if text == nil then
        text = getJobFullText(obj)
        cachedValues["$text"] = text
    end
    return text
end

local function resolveLogs(obj)
    local logs = cachedValues["$text.logs"] or ""
    if #logs == 0 then
        -- todo
    end
    return logs
end

local function latencyResolver(obj)
    local processedOn = tonumber(obj['processedOn'])
    local finishedOn = tonumber(obj['finishedOn'])
    if (isNumber(processedOn) and isNumber(finishedOn)) then
        return finishedOn - processedOn
    end
    return nil
end

local function waitTimeResolver()
    local processedOn = tonumber(obj['processedOn'])
    local timestamp = tonumber(obj['timestamp'] or processedOn)
    if (processedOn ~= nil) and (timestamp ~= nil) then
        return processedOn - timestamp
    end
    return nil
end

local function getFieldResolver(field)
  local handler = fieldHandlers[field]
  if (handler == nil) then
    local path = split(field, '.')
    local segment = #path > 0 and path[1] or field
    referencedFields[segment] = true
    local isnum = NUMERIC_FIELDS[segment]

    if (segment == 'latency') then
      handler = latencyResolver
    elseif segment == 'waitTime' then
      handler = waitTimeResolver
    else
      handler = function(obj)
        local val = resolve(obj, path)
        -- debug('value: ' .. tostr(val))
        return isnum and tonumber(val) or val
      end
    end
  end
  fieldHandlers[field] = handler
  return handler
end

--- EXPRESSION OPERATORS -------------------------------------------------------------
local ExprOperators = {}
ExprOperators.__index = ExprOperators

--
-- Parses an expression and returns a function which returns
-- the actual value of the expression using a given object as context
--
-- @param {table} expr the expression for the given field
-- @param {string} operator the operator to resolve the field with
-- @returns {function}
--
local function parseExpression(expr, operator)

  -- debug('parsing ' .. tostr(expr))

  local function parseArray()
    local compiled = {}
    for _, item in ipairs(expr) do
      compiled[#compiled + 1] = parseExpression(item)
    end
    return function(obj)
      local result = {}
      for _, fn in ipairs(compiled) do
        local v = fn(obj)
        result[#result + 1] = (v == nil) and cjson.null or v
      end
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
      local result = {}
      for key, fn in pairs(compiled) do
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
    return every(args, toBool)
  end
end

ExprOperators['$or'] = function(expr)
  local exec = parseExpression(expr)
  return function(obj)
    local args = exec(obj)
    assert(isArray(args), '$or: expected an array of expressions')
    for _, v in ipairs(args) do
      if (toBool(v)) then return true end
    end
    return false
  end
end

ExprOperators['$not'] = function(expr)
  local exec = parseExpression(expr)
  -- todo: make sure its a single value
  return function(obj)
    local value = exec(obj)
    -- todo assert(isBoolean(value), '$not: boolean expression expected')
    return not toBool(value)
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
    for _, x in ipairs(arr) do
      if isEqual(x, val) then
        return true
      end
    end
    return false
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
    if (a < b) then return -1 end
    if (a > b) then return 1 end
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

--- { $text: value }  or { $text: { $search: value } }
ExprOperators['$text'] = function(expr)

    local function isMatch(obj, needle)
        local haystack = resolveFullText(obj)
        if string.find(needle, haystack) then
            return true
        end
        local logs = resolveLogs(obj)
        if string.find(needle, logs) then
            return true
        end
        return false
    end

    local needle = expr["$search"] or expr
    local valueType = type(needle)
    if valueType == "string" then
        return function(obj)
            return isMatch(obj, needle)
        end
    end

    assert(isArray(needle) and #needle > 0, 'search expression must be a string or string array')
    local exec = parseExpression(needle)
    return function(obj)
        local args = exec(obj)
        for _, v in ipairs(args) do
            if isMatch(v) then
                return true
            end
        end
        return false
    end
end

local function createComparison(name)
  local fn = Predicates[name]
  ExprOperators[name] = function(expr)
    local exec = parseExpression(expr)
    return function(obj)
      local args = exec(obj)
      assert(isArray(args) and #args == 2, name .. ': comparison expects 2 arguments. Got ' .. tostr(args))
      local val = fn(args[1], args[2])
      debug('Comparison: ' .. tostr(args[1]) .. ' ' .. name .. ' ' .. tostr(args[2]) .. ' = ' .. tostr(val))
      return val
    end
  end
end

local function initOperators()
  for name, predicate in pairs(Predicates) do
    QueryOperators[name] = function(selector, value)
      local resolveFn = getFieldResolver(selector)

      return function(obj)
        -- value of field must be fully resolved.
        local lhs = resolveFn(obj)
        local val = predicate(lhs, value)
        debug('Predicate: ' .. tostr(lhs) .. ' ' .. name .. ' ' .. tostr(value) .. ' = ' .. tostr(val))
        return val
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
    local v = job['progress']
    if (v ~= nil) then
      local num = tonumber(v)
      if (num ~= nil) then
        job['progress'] = num
      end
      -- todo: handle json
    end
  end
end

local function prepJsonField(job, name)
  if referencedFields[name] then
    local saved = job[name]
    local success, res = pcall(cjson.decode, saved)
    if (success) then
      job[name] = res
    else
      -- todo: throw
    end
    return saved
  end
end

local function prepareJobHash(id, jobHash)
  local job = to_hash(jobHash)
  job['id'] = id
  prepJsonField(job, 'data')
  prepJsonField(job, 'opts')
  prepJsonField(job, 'stackTrace')
  prepProgress(job)
  return job
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

--------[[ Cursor Management ]]--------
local function isCursorMeta(item)
    return string.match(item, "__meta__")
end

-- attempt to read "count" jobs filtered fron previous iterations
local function getJobsFromCursor(count)
    if #cursorKey == 0 or count == 0 then return {} end
    local len = rcall("LLEN", cursorKey)
    local result = {}
    local cursor = nil
    local total = 0
    local done = true

    if len == 0 then
        return result, cursor, total
    end
    if count >= len then
        count = len - 1
    else
        done = false
    end
    local foundMeta = rcall("LINDEX", cursorKey, -1)
    if foundMeta then
        local success, res = pcall(cjson.decode, meta)
        if success then
            local meta = res["__meta__"]
            cursor = toNumber(meta["cursor"] or 0)
            total = toNumber(meta["total"] or 0)
        end
    end
    --- the last element of the list contains meta
    local items = rcall("LPOP", cursorKey, count)
    for _, item in ipairs(items) do
        -- check for meta
        if not isCursorMeta(item) then
            local success, res = pcall(cjson.decode, item)
            if success then
                result[#result+1] = res
            end
        end
    end
    return result, cursor, total, done
end

local function writeCursorMeta(cursor, total, lastId)
    local str = "{ __meta__: { cursor:" .. cursor .. ', total:' .. total .. ", lastId: " .. lastId  .. "}}"
    if #cursorKey == 0 then return end
    local lastItem = rcall("RPOP", cursorKey)
    if lastItem ~= nil then
        if not isCursorMeta(lastItem) then
            rcall("RPUSH", cursorKey, lastItem)
        end
    end
    rcall("RPUSH", cursorKey, str)
end

local function storeRemainders(items, cursor, total, lastId)
    if #cursorKey == 0 then
        return
    end
    for _, item in ipairs(items) do
        redis.pcall("LPUSH", cursorKey, item)
    end
    writeCursorMeta(cursor, total, lastId)
    rcall("EXPIRE", cursorKey, CURSOR_EXPIRATION)
end

--------[[ Main ]]--------
local function search(stateKey, criteria, count, asc)
    count = count or 100
    fieldHandlers = {}
    referencedFields = {}
    local predicate = compileQuery(criteria)
    local cursor = 0

    local found = 0
    --- cursor, total
    local result = {cursor, 0}

    local jobs, savedCursor, savedTotal, finished = getJobsFromCursor(count)
    if savedCursor ~= nil then
        found = #jobs
        for _, job in jobs do
            table.insert(result, job)
        end
        result[1] = savedCursor + found
        result[2] = savedTotal
        if found == count then
            return result
        end
    else
        cursor = 0
    end

    if finished and savedCursor ~= nil then
        cursor = savedCursor
    end

    local rangeStart = cursor
    local rangeEnd = cursor + count - 1
    local newCursor = rangeEnd + 1

    local keyPrefix, status = splitKey(stateKey)

    local scannedJobIds, total = getKeysForState(stateKey, status, rangeStart, rangeEnd, asc)
    if #scannedJobIds == 0 then
        return { total, total }
    end

    local lastId = ""
    local remainder = {}
    local result = { newCursor, total }

    for _, jobId in pairs(scannedJobIds) do

        local jobIdKey = keyPrefix .. jobId
        local jobHash = redis.pcall('HGETALL', jobIdKey)

        if (isObject(jobHash) and #jobHash) then
            clearCachedValues()
            local job = prepareJobHash(jobId, jobHash)
            if (predicate(job)) then
                jobHash["id"] = jobId
                local success, serialized = pcall(cjson.encode, jobHash)
                if success then
                    found = found + 1
                    if found > count then
                        table.insert(remainder, serialized)
                    else
                        table.insert(result, serialized)
                    end
                end
            end
        end

        lastId = jobId
    end

    if #remainder > 0 then
        storeRemainders(remainder, newCursor, total, lastId)
    end

    return result
end

stateKey = KEYS[1]
cursorKey = KEYS[2]
local criteria = assert(cjson.decode(ARGV[1]), 'Invalid filter criteria. Expected a JSON encoded string')
local count = tonumber(ARGV[2] or 10)
local asc = toBool(ARGV[3] or true)

initOperators()
return search(stateKey, criteria, count, asc)