export interface ServerQuery {
  [key: string]: any;
}

interface RegexValue {
  type: 'regex_value';
  value: string;
  ignoreCase: boolean;
}

type RangeValue = {
  type: 'range_value';
  lower?: string;
  upper?: string;
  lowerInclusive?: boolean;
  upperInclusive?: boolean;
};

type SimpleValue = {
  type: 'simple_value';
  value: string;
};

interface OperatorToken {
  type: 'operator';
  name: 'AND' | 'OR' | 'NOT';
}

type GroupStartToken = 'GROUP_START';
type GroupEndToken = 'GROUP_END';

interface FieldToken {
  type: 'field';
  name: string;
}

type Token =
  | OperatorToken
  | FieldToken
  | GroupStartToken
  | GroupEndToken
  | RegexValue
  | RangeValue
  | SimpleValue;

function isField(candidate: Token): candidate is FieldToken {
  return (candidate as FieldToken).type == 'field';
}

function isOperator(candidate: Token): candidate is OperatorToken {
  return (candidate as OperatorToken).type == 'operator';
}

function isGroupStart(candidate: Token): candidate is GroupStartToken {
  return typeof candidate === 'string' && candidate == 'GROUP_START';
}

function isGroupEnd(candidate: Token): candidate is GroupStartToken {
  return typeof candidate === 'string' && candidate == 'GROUP_END';
}

function isRegexValue(candidate: Token): candidate is RegexValue {
  return (candidate as RegexValue).type == 'regex_value';
}

function isRangeValue(candidate: Token): candidate is RangeValue {
  return (candidate as RangeValue).type == 'range_value';
}

function isSimpleValue(candidate: Token): candidate is SimpleValue {
  return (candidate as SimpleValue).type == 'simple_value';
}

function getTokenType(candidate: Token): string {
  if (typeof candidate === 'string') {
    return candidate;
  }
  if (typeof candidate === 'object') {
    const typ = candidate['type'];
    const parts = typ.split('_');
    return parts.join(' ');
  }
  return (candidate as SimpleValue).type;
}

function getTokenValue(candidate: Token): string {
  if (typeof candidate === 'string') {
    return candidate;
  }
  if (typeof candidate === 'object') {
    const temp = candidate as Record<string, any>;
    const value = temp['name'] || temp['value'] || candidate;
    return value.toString();
  }
  return getTokenType(candidate);
}
/**
 * Translates a Lucene-style query string into a MongoDB-style query document
 * @param luceneQuery - The Lucene query string to translate
 * @returns MongoDB-style query document
 */
export function parseSearchQuery(luceneQuery: string): ServerQuery {
  if (!luceneQuery || luceneQuery.trim() === '') {
    return {};
  }

  const tokens = tokenizeQuery(luceneQuery.trim());
  const parsedQuery = parseTokens(tokens);

  return simplifyQuery(parsedQuery);
}

/**
 * Tokenizes the query string, respecting quoted values and parentheses
 */
function tokenizeQuery(query: string): Token[] {
  const tokens: Token[] = [];
  let currentToken = '';
  let inQuotes = false;
  let quoteChar = '';
  let inRange = false;
  let inRegex = false;
  let regexIgnoreCase = false;

  const isIdentifierStart = (ch: string) => /[A-Za-z$_]/.test(ch);
  const isIdentifierPart = (ch: string) => /[A-Za-z0-9$_.]/.test(ch);

  function flushCurrentToken() {
    if (currentToken) {
      tokens.push(createToken(currentToken));
      currentToken = '';
    }
  }

  for (let i = 0; i < query.length; i++) {
    const char = query[i];

    // Possible field:value
    if (!inQuotes && !inRange && !inRegex) {
      // If the currentToken is empty, and we see an identifier start, peek ahead for identifier: pattern
      if (currentToken === '' && isIdentifierStart(char)) {
        // Try to read a full identifier without committing to the currentToken yet
        let j = i;
        let ident = query[j++];
        while (j < query.length && isIdentifierPart(query[j])) {
          ident += query[j++];
        }
        if (j < query.length && query[j] === ':') {
          // It's a FIELD
          tokens.push({ type: 'field', name: ident });
          i = j; // position on ':'
          continue; // skip adding ':' to any token; value parsing continues next loop
        }
        // Not a field, fall through and build as part of value
      }
    }

    // Enter regex mode only when not in quotes/range, and the token is empty (start of a value)
    if (
      char === '/' &&
      !inQuotes &&
      !inRange &&
      !inRegex &&
      currentToken === ''
    ) {
      inRegex = true;
      currentToken += char;
      continue;
    }

    if (inRegex) {
      if (char === '\\') {
        // Include escape and the next character if present
        if (i + 1 >= query.length) {
          throw new Error('Unterminated regex: trailing backslash');
        }
        currentToken += char + query[i + 1];
        i++;
        continue;
      }
      if (char === '/') {
        // Potential end of regex. Look ahead for an optional `i` flag
        let endChars = 1;
        if (i + 1 < query.length && query[i + 1] === 'i') {
          regexIgnoreCase = true;
          currentToken += '/i';
          i++; // consume 'i'
          endChars += 1;
        } else {
          currentToken += '/';
        }

        const inner = currentToken.substring(1, currentToken.length - endChars);
        currentToken = '';

        // Validate: ensure regex metacharacters are escaped where required
        validateRegexToken(inner);
        const token: Token = {
          type: 'regex_value',
          value: inner,
          ignoreCase: regexIgnoreCase,
        };

        tokens.push(token);
        inRegex = false;
        regexIgnoreCase = false;
        continue;
      }
      // Inside regex body
      currentToken += char;
      continue;
    }

    // Handle + and - prefixes before non-quoted values (Lucene semantics)
    // + means required (AND), - means exclusion (NOT)
    if (
      (char === '+' || char === '-') &&
      !inQuotes &&
      !inRange &&
      currentToken === ''
    ) {
      // Look ahead to see if this is a prefix to a value (not just a standalone operator)
      if (i + 1 < query.length && query[i + 1] !== ' ') {
        // This is a prefix operator
        if (char === '+') {
          tokens.push({ type: 'operator', name: 'AND' });
        } else {
          tokens.push({ type: 'operator', name: 'NOT' });
        }
        continue;
      }
    }

    // Handle range brackets - keep everything between [ and ] together
    if ((char === '[' || char == '{') && !inQuotes) {
      inRange = true;
      currentToken += char;
      continue;
    }

    if ((char === ']' || char == '}') && !inQuotes && inRange) {
      inRange = false;
      currentToken += char;
      const token = parseRangeQuery(currentToken);
      tokens.push(token);
      currentToken = '';
      continue;
    }

    // Handle parentheses as separate tokens
    if ((char === '(' || char === ')') && !inQuotes && !inRange) {
      flushCurrentToken();
      tokens.push(char === '(' ? 'GROUP_START' : 'GROUP_END');
      continue;
    }

    // Handle quotes
    if ((char === '"' || char === "'") && !inQuotes && !inRange) {
      inQuotes = true;
      quoteChar = char;
      currentToken += char;
    } else if (char === quoteChar && inQuotes) {
      inQuotes = false;
      currentToken += char;
      flushCurrentToken();
    } else if (char === ' ' && !inQuotes && !inRange) {
      flushCurrentToken();
    } else {
      currentToken += char;
    }
  }

  if (inRegex) {
    throw new Error('Unterminated regex: missing closing delimiter "/"');
  }

  if (currentToken) {
    tokens.push(createToken(currentToken));
  }

  return tokens;
}

/**
 * Lexer for SimpleValue tokens
 * Handles naked strings (no spaces), single-quoted, and double-quoted strings
 * @param query - The query string to lex
 * @param startIndex - Starting position in the query
 * @returns Object containing the parsed value and the next index, or null if no valid token found
 */
function lexSimpleValue(
  query: string,
  startIndex: number,
): { value: string; nextIndex: number } | null {
  let i = startIndex;

  // Skip leading whitespace
  while (i < query.length && query[i] === ' ') {
    i++;
  }

  if (i >= query.length) {
    return null;
  }

  const char = query[i];

  // Handle quoted strings (single or double quotes)
  if (char === '"' || char === "'") {
    const quoteChar = char;
    let value = quoteChar;
    i++; // Move past the opening quote

    while (i < query.length) {
      const currentChar = query[i];

      // Handle escape sequences
      if (currentChar === '\\' && i + 1 < query.length) {
        value += currentChar + query[i + 1];
        i += 2;
        continue;
      }

      // Check for closing quote
      if (currentChar === quoteChar) {
        value += currentChar;
        i++;
        return { value, nextIndex: i };
      }

      value += currentChar;
      i++;
    }

    // Unterminated quoted string
    throw new Error(
      `Unterminated quoted string starting at position ${startIndex}`,
    );
  }

  // Handle naked strings (no quotes, no spaces)
  // Stop at: space, parentheses, quotes, or special query characters
  const stopChars = new Set([' ', '(', ')', '"', "'", '[', ']', '{', '}']);
  let value = '';

  while (i < query.length) {
    const currentChar = query[i];

    // Stop at any terminator character
    if (stopChars.has(currentChar)) {
      break;
    }

    value += currentChar;
    i++;
  }

  // Return null if no value was captured
  if (value.length === 0) {
    return null;
  }

  return { value, nextIndex: i };
}

/**
 * Creates a token with the appropriate type
 */
function createToken(tokenStr: string): Token {
  const upperToken = tokenStr.toUpperCase();

  if (upperToken === 'AND' || upperToken === 'OR' || upperToken === 'NOT') {
    return { type: 'operator', name: upperToken };
  } else if (tokenStr === '(' || tokenStr === ')') {
    return tokenStr === '(' ? 'GROUP_START' : 'GROUP_END';
  } else {
    return { type: 'simple_value', value: tokenStr };
  }
}

/**
 * Parses tokens into an AST-like structure
 */
function parseTokens(tokens: Token[]): any {
  let index = 0;

  function parseExpression(minPrecedence = 0): any {
    let left = parsePrimary();

    while (index < tokens.length) {
      const token = tokens[index];

      if (isGroupEnd(token)) {
        break;
      }

      if (isOperator(token)) {
        const precedence = getOperatorPrecedence(token.name);

        // Check if this operator should be processed at this precedence level
        if (precedence < minPrecedence) {
          break;
        }

        const name = token.name;
        index++;

        // For left-associative operators, we need to parse the right side with higher precedence
        const right = parseExpression(precedence + 1);

        if (name === 'AND') {
          left = { $and: [left, right] };
        } else if (name === 'OR') {
          left = { $or: [left, right] };
        } else {
          // NOT as a binary operator (shouldn't happen in correct Lucene syntax)
          left = { $and: [left, { $not: right }] };
        }
      } else if (
        !isGroupStart(token) &&
        !isField(token) &&
        !isOperator(token)
      ) {
        // Implicit AND for adjacent terms
        const right = parseExpression(getOperatorPrecedence('AND') + 1);
        left = { $and: [left, right] };
      } else {
        break;
      }
    }

    return left;
  }

  function parsePrimary(): any {
    const token = tokens[index++];

    if (isGroupStart(token)) {
      const expression = parseExpression(0);
      // Skip the closing parenthesis
      if (index < tokens.length && isGroupEnd(tokens[index])) {
        index++;
      }
      return expression;
    }

    if (isOperator(token) && token.name === 'NOT') {
      const expression = parsePrimary();
      if (expression.$not) {
        return expression;
      }
      return { $not: expression };
    }

    if (isField(token)) {
      const identifier = token.name;
      if (index > tokens.length - 1) {
        throw new Error(`Unexpected end of query after field: ${identifier}`);
      }
      const valueToken = tokens[index++];
      // handle regex, range, simple value
      if (isSimpleValue(valueToken)) {
        return parseTokenValue(identifier, valueToken.value);
      } else if (isRangeValue(valueToken)) {
        return getRangeFilter(identifier, valueToken);
      } else if (isRegexValue(valueToken)) {
        return getRegexFilter(
          identifier,
          valueToken.value,
          valueToken.ignoreCase,
        );
      }
    }

    // Handle simple values (something like "quick brown fox")
    if (!isSimpleValue(token)) {
      const tokenType = getTokenType(token);
      const tokenValue = getTokenValue(token);
      throw new Error(`Unexpected token: ${tokenType} - ${tokenValue}`);
    } else {
      const plain = [];
      const regexes = [];
      index--;
      while (index < tokens.length) {
        const t = tokens[index];
        if (isSimpleValue(t)) {
          const value = t.value;
          if (!isQuoted(value) && containsRegexMetaChars(value)) {
            const regexFilter = getRegexFilter('dummy', value, false);
            const inner = regexFilter?.dummy?.$regex;
            console.log('regex inner', inner);
            regexes.push(inner);
          } else {
            plain.push(value);
          }
          index++;
        } else {
          break;
        }
      }

      let plainFilter: ServerQuery | undefined = undefined;
      let regexFilter: ServerQuery | undefined = undefined;

      if (plain.length > 0) {
        const val = plain.length == 1 ? plain[0] : plain;
        plainFilter = { $text: { $search: val } };
      }

      if (regexes.length > 0) {
        const subFilters = { $regex: regexes };
        regexFilter = { $text: subFilters };
      }

      if (plainFilter && regexFilter) {
        return { $and: [plainFilter, regexFilter] };
      } else if (plainFilter) {
        return plainFilter;
      } else {
        return regexFilter;
      }
    }
  }

  return parseExpression(0);
}

/**
 * Returns operator precedence levels for Lucene semantics
 * Higher number = higher precedence
 * NOT (unary) is handled in parsePrimary, not here
 */
function getOperatorPrecedence(operator: 'AND' | 'OR' | 'NOT'): number {
  switch (operator) {
    case 'OR':
      return 1;
    case 'AND':
      return 2;
    case 'NOT':
      return 3; // NOT as a binary operator (rare)
    default:
      return 0;
  }
}

function isQuoted(v: string): boolean {
  if (v.length < 2) {
    return false;
  }
  const first = v[0];
  const last = v[v.length - 1];
  return first == last && (first === "'" || first == `"`);
}

const RangeRegex =
  /^(?:([a-zA-Z_][a-zA-Z0-9_.]*)\s*:\s*)?([[{])([^}]+)\s+TO\s+([^}\]]+)\s*([\]}])$/;

function parseRangeQuery(token: string): RangeValue {
  // Handle range queries [value TO value]
  const match = token.match(RangeRegex);
  if (match) {
    const lowerInclusive = token[0] == '[';
    const upperInclusive = token[token.length - 1] == ']';
    const [_, lowValue, highValue] = match;
    const lower = isQuoted(lowValue)
      ? lowValue.substring(1, lowValue.length - 1)
      : lowValue;
    const upper = isQuoted(highValue)
      ? highValue.substring(1, highValue.length - 1)
      : highValue;
    return {
      type: 'range_value',
      lower,
      upper,
      upperInclusive,
      lowerInclusive,
    };
  } else {
    // throw an error
    throw new Error('Invalid range query format: expected [value TO value]');
  }
}

/**
 * Parses a single token value into a MongoDB condition
 */
function parseTokenValue(field: string, token: string): any {
  // Handle quoted values
  let value = token;
  let exact = false;

  if (isQuoted(token)) {
    exact = true;
    value = token.substring(1, token.length - 1);
  }

  // Check if it's a field:value pair
  if (!field?.length) {
    // No field specified, search in all fields (text search)
    return { $text: { $search: value } };
  }

  if (!exact) {
    // Handle wildcard queries
    if (containsRegexMetaChars(value)) {
      return getRegexFilter(field, value);
    }

    // Handle numeric values
    const numericValue = parseFloat(value);
    if (!isNaN(numericValue) && value.trim() !== '') {
      return { [field]: numericValue };
    }

    // Handle boolean values
    const lowerValue = value.toLowerCase();
    if (lowerValue === 'true' || lowerValue === 'false') {
      return { [field]: value.toLowerCase() === 'true' };
    }
  }

  // Default: treat as string
  return { [field]: value };
}

/**
 * Parses range queries like [value1 TO value2]
 */
function getRangeFilter(field: string, value: RangeValue): any {
  const rangeQuery: any = {};

  const lower = value.lower;
  const upper = value.upper;

  const parseValue = (value: string): string | number => {
    const lowerNum = parseFloat(value);
    if (isNaN(lowerNum)) {
      return value;
    }
    return lowerNum;
  };

  if (lower !== '*') {
    const lowerNum = parseValue(lower);
    if (value.lowerInclusive) {
      rangeQuery.$gte = lowerNum;
    } else {
      rangeQuery.$gt = lowerNum;
    }
  }

  if (upper !== '*') {
    const upperNum = parseValue(upper);
    if (value.upperInclusive) {
      rangeQuery.$lte = upperNum;
    } else {
      rangeQuery.$lt = upperNum;
    }
  }

  return { [field]: rangeQuery };
}

/**
 * Validates that regex metacharacters are escaped inside a delimited regex.
 * Raises an error if unescaped metacharacters are found.
 */
function validateRegexToken(body: string): void {
  if (!isValidRegex(body)) {
    throw new Error(`Invalid regex pattern: "${body}"`);
  }
}

/**
 * Parses regex queries (between / .. /)
 */
function getRegexFilter(field: string, value: string, ignoreCase = false): any {
  // Convert Lucene wildcards to MongoDB regex
  let regexPattern = value.replace(/\*/g, '.*').replace(/\?/g, '.');

  // Ensure the pattern is anchored if it doesn't start with wildcard
  if (!regexPattern.startsWith('.*')) {
    regexPattern = '^' + regexPattern;
  }

  if (!regexPattern.endsWith('.*')) {
    regexPattern = regexPattern + '$';
  }

  const luaPattern = translateRegexToLuaPattern(regexPattern);
  const doc: ServerQuery = { $regex: luaPattern };
  if (ignoreCase) {
    doc.$options = 'i';
  }

  return { [field]: doc };
}

/**
 * Builds MongoDB query from the parsed AST
 */
function simplifyQuery(node: any): ServerQuery {
  if (!node || typeof node !== 'object') {
    return node;
  }

  if (node.$and) {
    const values = node.$and || [];
    const left = simplifyQuery(values[0]);
    const right = simplifyQuery(values[1]);

    // console.log(`${JSON.stringify(left)} AND ${JSON.stringify(right)}`);

    const rightConnector = getConnector(right);
    const leftConnector = getConnector(left);
    if (!leftConnector && !rightConnector) {
      // e.g. {name:"John"} AND {age:25} => {$and:[{name:"John"},{age:25}]}
      return { $and: [left, right] };
    } else if (leftConnector && rightConnector && rightConnector === '$and') {
      // eslint-disable-next-line max-len
      // eg.{$and:[{name:"John"},{age:25}]} AND {$and: {status:"active"}} => {$and:[{name:"John"},{age:25},{status:"active"}]}
      return { $and: [...left.$and, ...right.$and] };
    } else if (!leftConnector && rightConnector === '$and') {
      // e.g. {name:"John"} AND {$and: {status:"active"}} => {$and:[{name:"John"},{status:"active"}]}
      right.$and = [left, ...right.$and];
      return right;
    } else if (leftConnector === '$and') {
      // e.g. {$and:[{name:"John"},{age:25}]} AND {status:"active"} => {$and:[{name:"John"},{age:25},{status:"active"}]}
      if (!Array.isArray(left.$and)) {
        left.$and = [left.$and];
      }
      left.$and.push(right);
      return left;
    }

    return { $and: [left, right] };
  }

  if (node.$or) {
    const values = node.$or || [];
    const left = simplifyQuery(values[0]);
    const right = simplifyQuery(values[1]);

    const rightConn = getConnector(right);
    const leftConn = getConnector(left);

    // console.log(`${JSON.stringify(left)} OR ${JSON.stringify(right)}`);
    if (!leftConn && !rightConn) {
      return { $or: [left, right] };
    } else if (leftConn && rightConn && rightConn === '$or') {
      left.$or.push(right.$or);
      return left;
    } else if (right.$or) {
      right.$or = [left, ...right.$or];
      return right;
    } else if (left.$or) {
      if (!Array.isArray(left.$or)) {
        left.$or = [left.$or];
      }
      left.$or.push(right);
    }

    return { $or: [left, right] };
  }

  if (node.$not) {
    const expression = simplifyQuery(node.$not);
    if (expression) {
      return { $not: expression };
    }
    return {};
  }

  // Leaf node (field condition)
  // console.log(`Leaf node: ${JSON.stringify(node)}`);
  return node;
}

function getConnector(
  node: ServerQuery,
  defaultConnector: '$or' | '$and' | undefined = undefined,
): '$or' | '$and' | undefined {
  if (typeof node !== 'object') {
    return defaultConnector;
  }
  if (node.$and) {
    return '$and';
  } else if (node.$or) {
    return '$or';
  } else {
    return defaultConnector;
  }
}

const regexMetaChars = /[.*+?^${}()|[\]\\]/;
function containsRegexMetaChars(str: string): boolean {
  return regexMetaChars.test(str);
}

/**
 * Translates standard regex character classes into equivalent Lua patterns
 * @param regexClass - The regex character class to translate (e.g., '\\d', '\\w', '\\s')
 * @returns The equivalent Lua pattern character class
 */
function translateRegexClassToLua(regexClass: string): string {
  const translationMap: { [key: string]: string } = {
    // Character classes
    '\\d': '%d', // digits
    '\\D': '%D', // non-digits
    '\\w': '%a', // alphanumeric characters (letters and digits)
    '\\W': '%A', // non-alphanumeric characters
    '\\s': '%s', // whitespace characters
    '\\S': '%S', // non-whitespace characters

    // Character class equivalents using sets
    '[0-9]': '%d',
    '[a-zA-Z]': '%a',
    '[a-zA-Z0-9]': '%a',
    '[^0-9]': '%D',
    '[^a-zA-Z]': '%A',
    '[^a-zA-Z0-9]': '%A',

    // Common character ranges
    '[a-z]': '[a-z]', // Lua supports this directly
    '[A-Z]': '[A-Z]', // Lua supports this directly
    '[0-9a-fA-F]': '[0-9a-fA-F]', // Lua supports hex ranges directly
  };

  // Direct translation for simple character classes
  if (translationMap[regexClass]) {
    return translationMap[regexClass];
  }

  // Handle custom character sets
  if (regexClass.startsWith('[') && regexClass.endsWith(']')) {
    return translateCustomCharacterSet(regexClass);
  }

  // Return original if no translation found
  return regexClass;
}

/**
 * Translates custom character sets from regex to Lua pattern syntax
 */
function translateCustomCharacterSet(charSet: string): string {
  let luaSet = charSet;

  // Replace common regex shorthand within character sets
  luaSet = luaSet.replace(/\\d/g, '0-9');
  luaSet = luaSet.replace(/\\w/g, 'a-zA-Z0-9');
  luaSet = luaSet.replace(/\\s/g, ' \\t\\r\\n'); // space, tab, carriage return, newline

  // Handle negated character sets (convert from regex [^abc] to Lua [^abc])
  // Note: Lua uses the same [^abc] syntax for negated sets
  if (luaSet.startsWith('[^') && luaSet.endsWith(']')) {
    // Lua supports the same negated set syntax
    return luaSet;
  }

  return luaSet;
}

const REGEX_TO_LUA_CHARACTER_CLASSES: Record<string, string> = {
  '\\d': '%d',
  '\\D': '%D',
  '\\w': '%a',
  '\\W': '%A',
  '\\s': '%s',
  '\\S': '%S',
  '\\b': '%f[%a]',
  '\\B': '%f[%A]',
};

/**
 * Comprehensive function to translate an entire regex pattern to Lua pattern
 * @param regexPattern - The full regex pattern to translate
 * @returns The equivalent Lua pattern
 */
export function translateRegexToLuaPattern(regexPattern: string): string {
  // Handle character class patterns early
  if (regexPattern.startsWith('[')) {
    const translated = translateRegexClassToLua(regexPattern);
    if (translated) {
      return translated;
    }
  }

  let luaPattern = regexPattern;

  // Translate character classes using the mapping
  for (const [regexClass, luaClass] of Object.entries(
    REGEX_TO_LUA_CHARACTER_CLASSES,
  )) {
    const regex = new RegExp(regexClass.replace(/\\/g, '\\\\'), 'g');
    luaPattern = luaPattern.replace(regex, luaClass);
  }

  // Recursively translate nested character sets
  luaPattern = luaPattern.replace(
    /\[([^\]]+)]/g,
    function (_match, innerContent: string) {
      return translateRegexToLuaPattern(innerContent);
    },
  );

  // Escape special Lua pattern characters that might conflict
  luaPattern = luaPattern.replace(/([%.%+%*%?%^%$%(%)%[%]%{%}])/g, '%%$1');

  return luaPattern;
}

function isValidRegex(pattern: string): boolean {
  try {
    new RegExp(pattern);
    return true;
  } catch (e) {
    if (e instanceof SyntaxError) {
      return false; // The pattern is not a valid regular expression
    }
    throw e; // Re-throw other types of errors
  }
}
