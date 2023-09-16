--[[
  Get Jobs by filter criteria
     Input:
        KEYS[1] Queue / Name Set Key
        ARGV[1] Key Prefix
        ARGV[2] filter criteria as a json encoded string
        ARGV[3] cursor
        ARGV[4] count
]]

local DEFAULT_SCAN_COUNT = 20

local NUMERIC_FIELDS = {
  ['timestamp'] = 1,
  ['processedOn'] = 1,
  ['finishedOn'] = 1,
  ['delay'] = 1,
}

local ADMIN_KEYS = {
  ['wait'] = 1,
  ['waiting'] = 1,
  ['events'] = 1,
  ['meta'] = 1,
  ['active'] = 1,
  ['completed'] = 1,
  ['failed'] = 1,
  ['stalled'] = 1,
  ['delayed'] = 1,
  ['paused'] = 1,
  ['repeat'] = 1,
  ['id'] = 1,
}

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
  ['string'] = true,
  ['null'] = true,
  ['nil'] = true,
  ['boolean'] = true,
  ['number'] = true,
  ['string'] = true,
}

local POSITIVE_INFINITY = 1e309;
--- UTILITY -----------------------------------------------------------------------------

--- https://lua.programmingpedia.net/en/tutorial/5829/pattern-matching
local IDENTIFIER_PATTERN = "[%a_]+[%a%d_]*"
local OPERATOR_NAME_PATTERN = "^$" .. IDENTIFIER_PATTERN

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
  for k2, v2 in pairs(o2) do
    local v1 = o1[k2]
    if isNil(v1) then
      return false
    end
  end
  return true
end

--- https://stackoverflow.com/questions/37753694/lua-check-if-a-number-value-is-nan
local function isNaN(number)
  return isNumber(number) and number ~= number
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
  for _, val in ipairs(arr) do
    if (fn(val)) then
      return true
    end
  end
  return false
end

local function every(arr, fn)
  for _, val in ipairs(arr) do
    if (not fn(val)) then return false end
  end
  return true
end

local function keys(obj)
  local res = {}
  for k, v in pairs(obj) do
    res[#res + 1] = k
  end
  return res
end

-- Create a new table of values by mapping each value in table through a transformation function
-- @param obj {table}
-- @param callback {function}
-- @return {*}
local function map(obj, callback)
  assert(isObject(obj), 'expected an array in map')

  local accumulator = {}

  for _, current in ipairs(obj) do
    table.insert(accumulator, callback(current, _))
  end

  return accumulator
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

---- Casting --------------------------------------------------

local function tonum(value, ...)
  local num = 0
  local t = type(value)
  if t == 'string' then
    local ok = pcall(function()
      num = value + 0
    end)
    if not ok then
      num = math.huge
    end
  elseif (t == 'boolean') then
    num = value and 1 or 0
  elseif (t == 'number') then
    num = value
  elseif (t == 'function') then
    num = tonum(value(...))
  end
  return num
end

local function tobool(value, ...)
  local bool = false
  local t = type(value)
  if t == 'string' then
    bool = #value > 0
  elseif t == 'boolean' then
    bool = value
  elseif (t == 'number') then
    bool = value ~= 0
  elseif t == 'function' then
    bool = bool(value(...))
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
  local function unwrap(arr, depth)
    if (depth < 1) then
      return arr
    end
    while (depth > 0 and #arr == 1) do
      arr = arr[1]
      depth = depth - 1
    end
    return arr
  end

  local function resolve2(o, path)
    local value = o
    local index = 1
    debug('resolving path ' .. tostr(path) .. ' in object ' .. tostr(o))

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
    if (not dedup[v]) and inArray(second, v) then
      len = len + 1
      t[len] = v
      dedup[v] = true
    end
  end
  return t
end

local function trunc(val)
  local x, _ = math.modf(val)
  return x
end
--
-- Truncates integer value to number of places. If roundOff is specified round value
-- instead to the number of places
-- @param {Number} num
-- @param {Number} places
-- @param {Boolean} roundOff
--
local function truncate(num, places, roundOff)
  local sign = math.abs(num) == num and 1 or -1
  num = math.abs(num)

  local result = trunc(num)
  local decimals = num - result

  if (places == 0) then
    local firstDigit = trunc(10 * decimals)
    if (roundOff and ((result % 2) ~= 0) and firstDigit >= 5) then
      result = result + 1
    end
  elseif (places > 0) then
    local offset = math.pow(10, places)
    local remainder = trunc(decimals * offset)

    -- last digit before cut off
    local lastDigit = trunc(decimals * offset * 10) % 10

    -- add one if last digit is greater than 5
    if (roundOff and lastDigit > 5) then
      remainder = remainder + 1
    end

    -- compute decimal remainder and add to whole number
    result = result + (remainder / offset)
  elseif (places < 0) then
    -- handle negative decimal places
    local offset = math.pow(10, -1 * places)
    local excess = result % offset
    result = math.max(0, result - excess)

    -- for negative values the absolute must increase so we round up the last digit if >= 5
    if (roundOff and sign == -1) then
      while (excess > 10) do
        excess = excess - (excess % 10)
      end
      if (result > 0 and excess >= 5) then
        result = result + offset
      end
    end
  end

  return result * sign
end

---- PREDICATES ------------------------------------------------------------------------
local Predicates = {}
Predicates.__index = Predicates

local function compare(a, b, fn)
  local btype = type(b)
  return some(ensureArray(a), function(x)
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

Predicates['$matches'] = function(a, pattern)
  assert(isString(pattern), '$matches: pattern should be a string')
  local arr = ensureArray(a)

  local function isMatch(x)
    return (isString(x)) and x:match(pattern)
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
  debug('exists: ' .. tostr(a) .. ', ' .. tostr(b) .. ', ' .. tostr(non_existent))
  return
  ((b == false or b == 0) and non_existent) or
          ((b == true or b == 1) and (not non_existent))
end

Predicates['$size'] = function(a, b)
  return isArray(a) and isNumber(b) and #a == b
end

Predicates['$mod'] = function(a, b)
  local arr = ensureArray(a)
  local valid = isArray(b) and #b == 2
  return some(arr, function(x)
    return isNumber(x) and valid and (x % b[1]) == b[2]
  end)
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

Predicates['$contains'] = function(haystack, needle)
  return isString(haystack) and -- todo: toString()
          isString(needle) and
          string.find(haystack, needle) ~= nil
end

Predicates['$startsWith'] = function(haystack, needle)
  return isString(haystack) and -- todo: toString()
          isString(needle) and
          string.sub(haystack, 1, string.len(needle)) == needle
end

Predicates['$endsWith'] = function(haystack, needle)
  if (not isString(haystack) or not isString(needle)) then return false end
  return needle=='' or string.sub(haystack, -string.len(needle)) == needle
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

  local function parse(criteria)
    for field, expr in pairs(criteria) do

      if ('$expr' == field) then
        processOperator(field, field, expr);
      elseif (field == '$and' or field == '$or' or field == '$nor') then
        processOperator(field, field, expr)
      else
        --- normalize expression
        local normalized = normalize(expr)

        for op, val in pairs(normalized) do
          assert(isOperator(op), 'unknown top level operator: "' .. op .. '"')
          processOperator(field, op, val)
        end
      end

    end

    assert(#compiled > 0, 'empty criteria: ' .. tostr(criteria))
    return join_AND(compiled)
  end

  return parse(criteria)
end

QueryOperators['$or'] = function(selector, value)
  assert(isArray(value),
          'Invalid expression. $or expects value to be an Array')

  local queries = {}
  for _, expr in ipairs(value) do
    queries[#queries + 1] = compileQuery(expr)
  end

  return join_OR(queries)
end

QueryOperators['$and'] = function(selector, value)
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
  local separator, fields = sep or ".", {}
  local pattern = string.format("([^%s]+)", separator)
  str:gsub(pattern, function(c)
    fields[#fields + 1] = c
  end)
  return fields
end

local fieldHandlers = {}
local referencedFields = {}

local function waitTimeResolver(obj)
  local timestamp = tonumber(obj['timestamp'])
  local processedOn = tonumber(obj['processedOn'])
  if (isNumber(timestamp) and isNumber(processedOn)) then
    return processedOn - timestamp
  end
  return nil
end

local function responseTimeResolver(obj)
  local timestamp = tonumber(obj['timestamp'])
  local finishedOn = tonumber(obj['finishedOn'])
  if (isNumber(timestamp) and isNumber(finishedOn)) then
    return finishedOn - timestamp
  end
  return nil
end

local function runtimeResolver(obj)
  local processedOn = tonumber(obj['processedOn'])
  local finishedOn = tonumber(obj['finishedOn'])
  if (isNumber(processedOn) and isNumber(finishedOn)) then
    return finishedOn - processedOn
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

    if (segment == 'runtime') then
      handler = runtimeResolver
    elseif (segment == 'waitTime') then
      handler = waitTimeResolver
    elseif (segment == 'responseTime') then
      handler = responseTimeResolver
    else
      handler = function(obj)
        local val = resolve(obj, path)
        debug('value: ' .. tostr(val))
        return isnum and tonumber(val) or val
      end
    end
    fieldHandlers[field] = handler
  end
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
QueryOperators['$expr'] = function(selector, value)
  return parseExpression(value)
end

local function parseSingleParamMathFn(name, expr, fn)
  local exec = parseExpression(expr);

  if (isNumber(expr)) then
    return constant(fn(expr))
  end

  return function(obj)
    local val = exec(obj)
    if (isNil(val)) then
      return nil
    end
    assert(isNumber(val), name .. ' expression must resolve to a number.')
    return fn(val)
  end
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
    local condition = tobool(ifExpr(obj))
    return condition and thenExpr(obj) or elseExpr(obj)
  end
end

ExprOperators['$switch'] = function(expr)
  local errorMsg = 'Invalid arguments for $switch operator';
  assert(isArray(expr['branches']), '$switch: expected "branches" array');

  local conditions = {}
  for _, branch in ipairs(expr['branches']) do
    assert(isObject(branch), '$switch: branch must be an object')
    local caseExpr = branch['case']
    local thenExpr = branch['then']
    assert(not isNil(caseExpr) and not isNil(thenExpr), errorMsg)
    local parsed = {
      ['case'] = parseExpression(caseExpr),
      ['then'] = parseExpression(thenExpr)
    }
    conditions[#conditions + 1] = parsed
  end
  local defaultExpr = expr['default']
  assert(defaultExpr ~= nil, '$switch: missing default branch')
  local defaultEval = parseExpression(defaultExpr)

  return function (obj)
    local found = false
    local fn
    for _, condition in ipairs(conditions) do
      local case = condition['case']
      found = case(obj)
      if (found) then
        fn = condition['then']
        break
      end
    end
    if (not isFunction(fn)) then fn = defaultEval end
    return fn(obj)
  end
end
----------------------------------------------------------------------------------------------------
ExprOperators['$concat'] = function(expr)
  local exec = parseExpression(expr)

  return function(obj)
    local values = exec(obj)

    assert(type(values) == 'table', '$concat expects an array')
    local result = ''
    for _, v in ipairs(values) do
      if (isNil(v)) then return nil end
      assert(isString(v), '$concat: all arguments must be string')
      result = result .. v
    end
    return result
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

ExprOperators['$strLenBytes'] = function(expr)
  local exec = parseExpression(expr)

  return function(obj)
    local val = exec(obj)
    if (isNil(val)) then return 0 end
    assert(isString(val), '$strLenBytes must resolve to a string')
    return val:len()
  end
end

ExprOperators['$substr'] = function(expr)
  local exec = parseExpression(expr)

  return function(obj)
    local args = exec(obj)
    assert(isArray(args) and #args >= 2,
            'expected $substr: [ <string>, <start>[, <length>] ]')
    local s = args[1]
    local start = args[2]
    if (isNil(s)) then return nil end
    assert(isString(s), '$substr: expected string as first argument')
    if (start < 0) then
      return ''
    end
    -- lua indexes start at 1
    if (start >= 0) then
      start = start + 1
    end
    local count = assert(tonumber(args[3] or #s), 'count should be a number')
    if (count < 0) then
      return s:sub(start, #s)
    end
    return s:sub(start, start + count - 1)
  end
end

ExprOperators['$substrBytes'] = ExprOperators['$substr']

ExprOperators['$toLower'] = function(expr)
  local exec = parseExpression(expr)

  return function(obj)
    local value = exec(obj)
    if (isNil(value)) then return nil end
    assert(isString(value), '$toLower: string expected')
    return #value > 0 and string.lower(value) or ''
  end
end

ExprOperators['$toUpper'] = function(expr)
  local exec = parseExpression(expr)

  return function(obj)
    local value = exec(obj)
    if (isNil(value)) then return nil end
    assert(isString(value), '$toUpper: string expected')
    return #value > 0 and string.upper(value) or ''
  end
end

local function trim(name, expr, left, right)
  local exec = parseExpression(expr)
  return function(obj)
    local args = exec(obj)
    local input, chars
    if (isString(args)) then
      input = args
    else
      assert(isObject(args), name .. ' expects an array or object')
      input = args['input'] or args[1]
      chars = args['chars'] or args[2]
      if (input == cjson.null) then return nil end
      assert(isString(input), name .. ': missing input')
    end
    if (#input == 0) then return '' end
    if (isNil(chars)) then
      if (left and right) then
        return (input:gsub("^%s*(.-)%s*$", "%1"))
      elseif left then
        return (input:gsub("^%s*", ""))
      elseif right then
        local n = #input
        while n > 0 and input:find("^%s", n) do n = n - 1 end
        return input:sub(1, n)
      end
      return input
    else
      assert(isString(chars), 'chars should be a string')
      local len = #input
      local codepoints = {}

      for i = 1, #chars do
        local ch = chars:sub(i, i)
        codepoints[ch] = true
      end

      --- debug('chars = ' .. chars .. ', codepoints = ' .. tostr(codepoints))
      local i = 1
      local j = len
      local s = input

      while (left and i < j and codepoints[s:sub(i,i)]) do
        i = i + 1
      end
      while (right and j > i and codepoints[s:sub(j,j)]) do
        j = j - 1
      end

      return s:sub(i, j)
    end
  end
end

ExprOperators['$trim'] = function(expr)
  return trim('$trim', expr, true, true)
end

ExprOperators['$ltrim'] = function(expr)
  return trim('$ltrim', expr, true, false)
end

ExprOperators['$rtrim'] = function(expr)
  return trim('$rtrim', expr, false, true)
end

ExprOperators['$split'] = function(expr)
  local exec = parseExpression(expr)
  return function(obj)
    local args = exec(obj)
    assert(isArray(args) and #args == 2, '$split requires an array(2)')
    local s = args[1]
    local delimiter = args[2]
    local result = {}
    if (isNil(s)) then return nil end
    assert(isString(delimiter), '$split requires a string delimiter');
    for match in (s..delimiter):gmatch("(.-)"..delimiter) do
      table.insert(result, match);
    end
    return result
  end
end

ExprOperators['$and'] = function(expr)
  local compute = parseExpression(expr)
  return function(obj)
    local args = compute(obj)
    return isArray(args) and every(args, tobool)
  end
end

ExprOperators['$or'] = function(expr)
  local exec = parseExpression(expr)
  return function(obj)
    local args = exec(obj)
    assert(isArray(args), '$or: expected an array of expressions')
    for _, v in ipairs(args) do
      if (tobool(v)) then return true end
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
    return not tobool(value)
  end
end

ExprOperators['$literal'] = function(expr)
  return constant(expr)
end

local function extrema(name, expr, comparator)
  if (isNumber(expr)) then
    -- take a short cut if expr is number literal
    return constant(expr)
  end

  local exec = parseExpression(expr)

  return function(obj)
    local items = exec(obj)
    if (isNil(items)) then
      return cjson.null
    end
    if (isNumber(items)) then
      return items
    end
    assert(isArray(items), name ..' expects an array of numbers')
    local res = cjson.null
    for _, n in ipairs(items) do
      if (isNumber(n)) then
        if (res == cjson.null) then
          res = n
        elseif (comparator(n, res)) then
          res = n
        end
      end
    end
    return res
  end
end

ExprOperators['$max'] = function(expr)
  return extrema('$max', expr, function(x,y) return x > y end)
end

ExprOperators['$min'] = function(expr)
  return extrema('$min', expr, function(x,y) return x < y end)
end

ExprOperators['$abs'] = function(expr)
  return parseSingleParamMathFn('$abs', expr, math.abs)
end

ExprOperators['$ceil'] = function(expr)
  return parseSingleParamMathFn('$ceil', expr, math.ceil)
end

ExprOperators['$floor'] = function(expr)
  return parseSingleParamMathFn('$floor', expr, math.floor)
end

ExprOperators['$sqrt'] = function(expr)
  return parseSingleParamMathFn('$sqrt', expr, math.sqrt)
end

ExprOperators['$add'] = function(expr)
  local exec = parseExpression(expr)

  return function(obj)
    local args = exec(obj)
    assert(isArray(args), '$add expects an array')
    local total = 0
    for _, val in ipairs(args) do
      if isNumber(val) then
        total = total + val
      end
    end
    return total
  end
end

ExprOperators['$subtract'] = function(expr)
  local exec = parseExpression(expr)

  return function(obj)
    local args = exec(obj)
    assert(isArray(args) and #args == 2, '$subtract expects an array of 2 arguments');
    return args[1] - args[2]
  end
end

ExprOperators['$multiply'] = function(expr)
  local exec = parseExpression(expr);

  return function(obj)
    local values = exec(obj);
    assert(isArray(values), '$multiply expects an array')
    local result = 1
    -- todo: pcall to prevent overflow
    for _, val in ipairs(values) do
      if (isNumber(val)) then
        result = result * val
      end
    end
    return result
  end
end

ExprOperators['$divide'] = function(expr)
  local exec = parseExpression(expr)

  return function(obj)
    local values = exec(obj)
    assert(isArray(values) and #values == 2, '$divide expects an array(2)')
    local divisor = tonumber(values[1])
    local dividend = tonumber(values[2])
    assert(isNumber(dividend) and dividend ~= 0, '$divide: dividend must be a non-zero number')
    return divisor / dividend;
  end
end

ExprOperators['$mod'] = function(expr)
  local exec = parseExpression(expr)
  return function(obj)
    local args = exec(obj)
    assert(isArray(args), '$mod should return an array(2)')
    local a = args[1]
    local b = args[2]
    return a % b
  end
end

ExprOperators['$round'] = function(expr)
  local exec = parseExpression(expr)
  return function(obj)
    local args = exec(obj)
    assert(type(args) == 'table', '$round: expects an array(2)')
    local num = args[1]
    local place = args[2]
    if (isNil(num) or isNaN(num) or math.abs(num) == POSITIVE_INFINITY) then return num end
    assert(isNumber(num), '$round expression must resolve to a number.')

    return truncate(num, place, true)
  end
end

ExprOperators['$trunc'] = function(expr)
  local exec = parseExpression(expr)
  return function(obj)
    local args = exec(obj)
    local num = args[1]
    local places = args[2]

    if (isNil(num) or isNaN(num) or math.abs(num) == POSITIVE_INFINITY) then return num end
    assert(isNumber(num), '$trunc expression must resolve to a number.')
    assert(isNil(places) or (isNumber(places) and places > -20 and places < 100),
            "$trunc expression has invalid place")
    return truncate(num, places, false)
  end
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

ExprOperators['$size'] = function(expr)
  local exec = parseExpression(expr)
  return function(obj)
    local expression = exec(obj)
    assert(isArray(expression), '$size: argument must resolve to an array')
    return #expression
  end
end

ExprOperators['$toString'] = function(expr)
  local exec = parseExpression(expr)
  return function(obj)
    local expression = exec(obj)
    return tostr(expression)
  end
end

ExprOperators['$toBool'] = function(expr)
  local exec = parseExpression(expr)
  return function(obj)
    local val = exec(obj)
    if (isNil(val)) then return false end
    if (val == true or val == false) then return val end
    if (isNumber(val)) then return val ~= 0 end
    return true
  end
end

-- s "sensible" toBool
ExprOperators['$toBoolEx'] = function(expr)
  local exec = parseExpression(expr)
  return function(obj)
    local val = exec(obj)
    if (isNil(val)) then return false end
    if (val == true or val == false) then return val end
    if (isNumber(val)) then return val ~= 0 end
    if (isString(val)) then
      if (val == 'true') then return true end
      if (val == 'false') then return false end
      return #val > 0
    end
    return true
  end
end

ExprOperators['$toDouble'] = function(expr)
  local exec = parseExpression(expr)
  return function(obj)
    local val = exec(obj)
    if (isNil(val)) then return nil end
    if (isNumber(val)) then return val end
    if (isBoolean(val)) then
      return val and 1 or 0
    end
    if (isString(val)) then
      local res = tonumber(val)
      if isNumber(res) then return res end
    end
    assert(false, 'cannot cast "' .. tostr(val) .. '" to double')
    return nil
  end
end

ExprOperators['$toInt'] = function(expr)
  local exec = parseExpression(expr)
  return function(obj)
    local val = exec(obj)
    if (isString(val)) then
      val = tonumber(val)
    end
    if (isNumber(val)) then
      return trunc(val)
    end
    if (isBoolean(val)) then
      return val and 1 or 0
    end
    assert(false, 'cannot cast "' .. tostr(val) .. '" to double')
    return nil
  end
end

ExprOperators['$toDecimal'] = ExprOperators['$toDouble']
ExprOperators['$toLong'] = ExprOperators['$toInt']
ExprOperators['$arrayElemAt'] = function(expr)
  local exec = parseExpression(expr)

  return function(obj)
    local arr = exec(obj)
    assert(isArray(arr) and #arr == 2, '$arrayElemAt expression must resolve to array(2)')
    -- assert(isArray(arr[1]), 'First operand to $arrayElemAt must resolve to an array');
    assert(isNumber(arr[1]), 'Second operand to $arrayElemAt must resolve to an integer')
    local idx = arr[2]
    arr = arr[1]
    -- translate from 0 to 1 bases
    if idx > 0 then idx = idx + 1 end
    local len = #arr
    if (idx < 0 and math.abs(idx) <= len) then
      return arr[idx + len]
    elseif (idx >= 0 and idx < len) then
      return arr[idx]
    end
    return nil
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
  createComparison('$contains')
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

local function getIdPart(key, prefix)
  local sub = key:sub(#prefix + 1)
  if sub:find(':') == nil and not ADMIN_KEYS[sub] then
    return sub
  end
  return nil
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

local function search(key, keyPrefix, criteria, cursor, count)
  count = count or DEFAULT_SCAN_COUNT
  fieldHandlers = {}
  referencedFields = {}
  local scanResult = {}
  local predicate = compileQuery(criteria)
  local match = keyPrefix .. '*'
  local fullScan = false

  local keyType = ''

  if (key ~= nil and #key > 0) then
    redis.call("TYPE", key)
    keyType = keyType["ok"]
  end

  if (keyType == 'zset') then
    scanResult = redis.call('zscan', key, cursor, "COUNT", count, 'MATCH', match)
  elseif keyType == 'set' then
    scanResult = redis.call('sscan', key, cursor, "COUNT", count, 'MATCH', match)
  else
    fullScan = true
    scanResult = redis.call('scan', cursor, "COUNT", count, 'MATCH', match)
  end

  local newCursor = scanResult[1]
  local scannedJobIds = scanResult[2]

  if (fullScan) then
    -- does a keyspace as opposed to list scan. Filter out non-ids
    local filteredIds = {}
    local i = 0
    for _, key in ipairs(scannedJobIds) do
      local id = getIdPart(key, keyPrefix)
      if (id ~= nil) then
        i = i + 1
        filteredIds[i] = id
      end
      scannedJobIds = filteredIds
    end
  elseif (keyType == 'zset') then
    -- strip out score
    scannedJobIds = map(scannedJobIds, function(val)
      return val[1]
    end)
  end

  local result = { newCursor }

  for _, jobId in pairs(scannedJobIds) do

    local jobIdKey = keyPrefix .. jobId
    local jobHash = redis.pcall('HGETALL', jobIdKey)

    debug('key: ' .. jobIdKey.. ', data: ' .. tostr(jobHash))

    if (isObject(jobHash) and #jobHash) then
      local job = prepareJobHash(jobId, jobHash)
      if (predicate(job)) then
        debug('Matched: ' .. tostr(job));
        table.insert(result, "jobId")
        table.insert(result, jobId)

        for _, value in pairs(jobHash) do
          table.insert(result, value)
        end
      end
    end
  end

  return result
end

local key = KEYS[1]
local prefix = assert(ARGV[1], 'Key prefix not specified')
local criteria = assert(cjson.decode(ARGV[2]), 'Invalid filter criteria. Expected a JSON encoded string')
local cursor = ARGV[3]
local count = ARGV[4] or DEFAULT_SCAN_COUNT

initOperators()
return search(key, prefix, criteria, cursor, count)

-- TODO: validate expression
