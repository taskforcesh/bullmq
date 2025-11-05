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
  quoted?: boolean;
};

type TermValue = {
  type: 'term';
  value: string;
};

type PhraseValue = {
  type: 'phrase';
  value: string;
};

type WildcardValue = {
  type: 'wildcard';
  value: string;
};

interface OperatorToken {
  type: 'operator';
  name: 'AND' | 'OR' | 'NOT' | 'XOR';
}

type GroupStartToken = 'GROUP_START';
type GroupEndToken = 'GROUP_END';
type ColonToken = ':';

const EXISTS_FIELD = '_exists_';

interface FieldToken {
  type: 'field';
  name: string;
}

type Token =
  | OperatorToken
  | FieldToken
  | GroupStartToken
  | GroupEndToken
  | ColonToken
  | TermValue
  | PhraseValue
  | WildcardValue
  | RegexValue
  | RangeValue
  | SimpleValue;

const IDENTIFIER_REGEX = /^[a-zA-Z_][a-zA-Z0-9_.]*$/;

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

function isTermValue(candidate: Token): candidate is TermValue {
  return (candidate as TermValue).type == 'term';
}

function isPhraseValue(candidate: Token): candidate is PhraseValue {
  return (candidate as PhraseValue).type == 'phrase';
}

function isWildcardValue(candidate: Token): candidate is WildcardValue {
  return (candidate as WildcardValue).type == 'wildcard';
}

function isValueToken(candidate: Token): boolean {
  return (
    isTermValue(candidate) ||
    isPhraseValue(candidate) ||
    isWildcardValue(candidate) ||
    isRegexValue(candidate) ||
    isRangeValue(candidate)
  );
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
    throw new Error(`Empty query string`);
  }

  const tokens = tokenizeQuery(luceneQuery.trim());
  const parsedQuery = parseTokens(tokens);
  return optimizeQuery(parsedQuery);
}

/**
 * Tokenizes the query string, respecting quoted values and parentheses
 */
function tokenizeQuery(query: string): Token[] {
  const tokens: Token[] = [];

  function isValidTermStart(ch: string): boolean {
    return /[A-Za-z0-9_*?"']/.test(ch);
  }

  function isIdentifier(str: string): boolean {
    return str && str.length && IDENTIFIER_REGEX.test(str);
  }

  for (let i = 0; i < query.length; i++) {
    const char = query[i];
    // Possible field:value
    if (isValidTermStart(char)) {
      const term = lexValue(query, i);
      if (term) {
        const token = term.token;
        // If we see an identifier start, peek ahead for identifier: pattern
        // see if the next char is ':', if so, it's a field
        if (term.nextIndex < query.length && query[term.nextIndex] === ':') {
          if (isTermValue(token) && isIdentifier(token.value)) {
            tokens.push({ type: 'field', name: token.value });
            i = term.nextIndex; // move to the colon
            continue;
          }
          const val = getTokenValue(token);
          throw new Error(`Invalid field name: "${val}" at position ${i}`);
        } else {
          // check to see if we need to insert an implicit AND
          if (tokens.length > 0) {
            const prevToken = tokens[tokens.length - 1];
            if (isValueToken(prevToken)) {
              let shouldInsertAnd = false;
              if (isValueToken(token)) {
                shouldInsertAnd = true;
              } else if (isOperator(token)) {
                if (token.name === 'NOT') {
                  shouldInsertAnd = true;
                }
              }
              if (shouldInsertAnd) {
                tokens.push({ type: 'operator', name: 'AND' }); // insert AND
              }
            }
          }
          tokens.push(token);
          i = term.nextIndex - 1; // -1 because loop will increment
        }
        continue;
      } // else fall through to normal processing
    }

    // Enter regex mode only when not in quotes/range, and the token is empty (start of a value)
    if (char === '/') {
      const regexResult = lexRegexValue(query, i);
      if (regexResult) {
        tokens.push(regexResult.regex);
        i = regexResult.nextIndex - 1; // -1 because loop will increment
        continue;
      }
    }

    // Handle - prefixes before non-quoted values (Lucene semantics)
    // + means required (AND), - means exclusion (NOT)
    if (char === '+' || char === '-') {
      // Look ahead to see if this is a prefix to a value (not just a standalone operator)
      if (i + 1 < query.length && query[i + 1] !== ' ') {
        // This is a prefix operator
        if (char === '-') {
          // + is ignored since the default connector is AND
          tokens.push({ type: 'operator', name: 'NOT' });
        }
        continue;
      }
    }

    if (char === '|') {
      tokens.push({ type: 'operator', name: 'OR' });
      continue;
    }

    if (char == '^') {
      tokens.push({ type: 'operator', name: 'XOR' });
      continue;
    }

    // Handle range brackets - keep everything between [ and ] together
    if (char === '[' || char == '{') {
      const rangeResult = lexRangeValue(query, i);
      if (rangeResult) {
        tokens.push(rangeResult.range);
        i = rangeResult.nextIndex - 1; // -1 because loop will increment
        continue;
      }
    }

    // Handle parentheses as separate tokens
    if (char === '(' || char === ')') {
      tokens.push(char === '(' ? 'GROUP_START' : 'GROUP_END');
      continue;
    }

    if (char === ' ') {
      i = skipWhitespace(query, i) - 1; // -1 because loop will increment
    } else {
      throw new Error(`Unrecognized character '${char}' at position ${i}`);
    }
  }

  return tokens;
}

/**
 * Lexer for term tokens
 * Handles naked strings (possibly field names), single-quoted, and double-quoted strings
 * @param query - The query string to lex
 * @param startIndex - Starting position in the query
 * @returns Object containing the parsed value and the next index, or null if no valid token found
 */
function lexValue(
  query: string,
  startIndex: number,
): { token: Token; nextIndex: number } | null {
  let i = startIndex;

  if (i >= query.length) {
    return null;
  }

  const char = query[i];

  // Handle quoted strings (single or double quotes)
  if (char === '"' || char === "'") {
    const quoteChar = char;
    let value = '';
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
        i++;
        const token: PhraseValue = {
          type: 'phrase',
          value,
        };

        return { nextIndex: i, token };
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
  const stopChars = new Set([
    ' ',
    '(',
    ')',
    '"',
    "'",
    '[',
    ']',
    '{',
    '}',
    ':',
    '|',
  ]);
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

  const token = createToken(value);

  return { nextIndex: i, token };
}

/**
 * Lexer for RangeValue tokens
 * Handles range queries in format [lower TO upper] or `{lower TO upper}`
 * Square brackets [] indicate inclusive bounds, curly braces `{}` indicate exclusive bounds
 * @param query - The query string to lex
 * @param startIndex - Starting position in the query
 * @returns Object containing the parsed range value and the next index, or null if no valid token found
 */
function lexRangeValue(
  query: string,
  startIndex: number,
): { range: RangeValue; nextIndex: number } | null {
  let i = startIndex;

  if (i >= query.length) {
    return null;
  }

  const openChar = query[i];

  // Must start with [ or {
  if (openChar !== '[' && openChar !== '{') {
    return null;
  }

  const lowerInclusive = openChar === '[';
  i++; // Move past the opening bracket

  // Parse lower bound value
  const lowerResult = parseRangeValueComponent(query, i);
  if (!lowerResult) {
    throw new Error(
      `Invalid range query: expected lower bound value at position ${i}`,
    );
  }

  const lower = lowerResult.value;

  // Skip whitespace before TO
  i = skipWhitespace(query, lowerResult.nextIndex);

  // Expect TO keyword
  if (
    i + 2 > query.length ||
    query.substring(i, i + 2).toUpperCase() !== 'TO'
  ) {
    throw new Error(
      `Invalid range query: expected 'TO' keyword at position ${i}`,
    );
  }
  i += 2;

  // Skip whitespace after TO
  i = skipWhitespace(query, i);

  // Parse upper bound value
  const upperResult = parseRangeValueComponent(query, i);
  if (!upperResult) {
    throw new Error(
      `Invalid range query: expected upper bound value at position ${i}`,
    );
  }

  const upper = upperResult.value;

  // Skip whitespace before the closing bracket
  i = skipWhitespace(query, upperResult.nextIndex);

  // Expect closing bracket
  if (i >= query.length) {
    throw new Error(
      `Invalid range query: missing closing bracket at position ${i}`,
    );
  }

  const closeChar = query[i];
  if (closeChar !== ']' && closeChar !== '}') {
    throw new Error(
      `Invalid range query: expected ']' or '}' at position ${i}, found '${closeChar}'`,
    );
  }

  const upperInclusive = closeChar === ']';
  i++; // Move past the closing bracket

  const range: RangeValue = {
    type: 'range_value',
    lower: lower === '*' ? undefined : lower,
    upper: upper === '*' ? undefined : upper,
    lowerInclusive,
    upperInclusive,
  };

  return { range, nextIndex: i };
}

/**
 * Helper function to parse a single component of a range value (lower or upper bound)
 * Handles: quoted strings, naked strings, wildcards (*), and numbers
 */
function parseRangeValueComponent(
  query: string,
  startIndex: number,
): { value: string; nextIndex: number } | null {
  const i = startIndex;

  if (i >= query.length) {
    return null;
  }

  const char = query[i];

  // Handle wildcard
  if (char === '*') {
    return { value: '*', nextIndex: i + 1 };
  }

  // Handle quoted strings or naked values
  const val = lexValue(query, i);
  if (val == null) {
    return null;
  }

  const token = val.token;
  const value = getTokenValue(token);
  if (isTermValue(token) || isPhraseValue(val.token) || isOperator(token)) {
    return {
      value,
      nextIndex: val.nextIndex,
    };
  }

  throw new Error(`Invalid token "${value}" for range value component`);
}

/**
 * Lexer for RegexValue tokens
 * Handles regex patterns in format /pattern/ or /pattern/i
 * @param query - The query string to lex
 * @param startIndex - Starting position in the query
 * @returns Object containing the parsed regex value and the next index, or null if no valid token found
 */
function lexRegexValue(
  query: string,
  startIndex: number,
): { regex: RegexValue; nextIndex: number } | null {
  let i = startIndex;

  if (i >= query.length) {
    return null;
  }

  // Must start with /
  if (query[i] !== '/') {
    return null;
  }

  i++; // Move past opening /

  let pattern = '';
  let escaped = false;

  // Parse the regex pattern body
  while (i < query.length) {
    const char = query[i];

    // Handle escape sequences
    if (escaped) {
      pattern += char;
      escaped = false;
      i++;
      continue;
    }

    // Check for escape character
    if (char === '\\') {
      pattern += char;
      escaped = true;
      i++;
      continue;
    }

    // Check for closing delimiter
    if (char === '/') {
      i++; // Move past closing /

      // Check for optional flags (currently only 'i' for case-insensitive)
      let ignoreCase = false;
      if (i < query.length && query[i] === 'i') {
        ignoreCase = true;
        i++; // Move past the 'i' flag
      }

      // Validate the regex pattern
      validateRegexPattern(pattern);

      const regex: RegexValue = {
        type: 'regex_value',
        value: pattern,
        ignoreCase,
      };

      return { regex, nextIndex: i };
    }

    pattern += char;
    i++;
  }

  // If we reach here, the regex was not properly closed
  throw new Error(
    `Unterminated regex pattern starting at position ${startIndex}`,
  );
}

/**
 * Validates that a regex pattern is syntactically correct
 * @param pattern - The regex pattern to validate
 * @throws Error if the pattern is invalid
 */
function validateRegexPattern(pattern: string): void {
  try {
    new RegExp(pattern);
  } catch (e) {
    if (e instanceof SyntaxError) {
      throw new Error(`Invalid regex pattern: "${pattern}" - ${e.message}`);
    }
    throw e;
  }
}

function skipWhitespace(query: string, index: number): number {
  while (index < query.length && query[index] === ' ') {
    index++;
  }
  return index;
}

/**
 * Creates a token with the appropriate type
 */
function createToken(tokenStr: string): Token {
  const upperToken = tokenStr.toUpperCase();

  if (
    upperToken === 'AND' ||
    upperToken === 'OR' ||
    upperToken === 'NOT' ||
    upperToken === 'XOR'
  ) {
    return { type: 'operator', name: upperToken };
  } else if (tokenStr === '(' || tokenStr === ')') {
    return tokenStr === '(' ? 'GROUP_START' : 'GROUP_END';
  } else {
    if (SimpleRegexPattern.test(tokenStr)) {
      return {
        type: 'wildcard',
        value: tokenStr,
      };
    }
    return { type: 'term', value: tokenStr };
  }
}

/**
 * Parses an array of tokens into a structured query object (AST-like structure)
 * Supports:
 * - Field-value pairs (field:value)
 * - Logical operators (AND, OR, NOT)
 * - Grouped expressions with parentheses
 * - Range queries ([min TO max])
 * - Regex patterns (/pattern/i)
 * - Wildcard queries (*, ?)
 *
 * @param tokens - Array of tokens to parse
 * @returns Parsed query structure
 */
function parseTokens(tokens: Token[]): any {
  let index = 0;
  let inFieldGroup = false;
  let groupDepth = 0;
  let groupedFieldName: string | null = null;

  // Validate parentheses before parsing
  validateParentheses(tokens);

  /**
   * Parses an expression with operator precedence handling
   * @param minPrecedence - Minimum precedence level for operators to process
   */
  function parseExpression(minPrecedence = 0): any {
    let left = parsePrimary();

    while (index < tokens.length) {
      const token = tokens[index];

      // Stop at the group end
      if (isGroupEnd(token)) {
        break;
      }

      if (isOperator(token)) {
        const precedence = getOperatorPrecedence(token.name);

        // Check if this operator should be processed at this precedence level
        if (precedence < minPrecedence) {
          break;
        }

        const operatorName = token.name;
        index++;

        // make sure we don't have two operators in a row
        if (index >= tokens.length) {
          throw new Error(
            `Unexpected end of query after operator: ${operatorName}`,
          );
        }

        // For left-associative operators, we need to parse the right side with higher precedence
        const right = parseExpression(precedence + 1);

        if (operatorName === 'AND') {
          left = { $and: [left, right] };
        } else if (operatorName === 'OR') {
          left = { $or: [left, right] };
        } else if (operatorName === 'XOR') {
          left = { $xor: [left, right] };
        } else {
          // NOT as a binary operator (shouldn't happen in correct Lucene syntax)
          left = { $and: [left, { $not: right }] };
        }
      } else if (!isGroupEnd(token)) {
        // Implicit AND for adjacent terms
        const right = parseExpression(getOperatorPrecedence('AND') + 1);
        left = { $and: [left, right] };
      } else {
        throw new Error(
          `Unexpected token in expression: ${getTokenType(token)}`,
        );
      }
    }

    return left;
  }

  /**
   * Parses primary expressions:
   * - Grouped expressions: (expression)
   * - Unary NOT: NOT expression
   * - Field expressions: field:value or field:(grouped values)
   * - Simple values: text search terms
   */
  function parsePrimary(): any {
    if (index >= tokens.length) {
      throw new Error('Unexpected end of query');
    }
    const token = tokens[index++];

    // Handle grouped expressions
    if (isGroupStart(token)) {
      if (inFieldGroup) {
        throw new Error('Nested groups are not allowed within field groups');
      }

      const startDepth = groupDepth;
      groupDepth++;

      const expression = parseExpression(0);

      // Expect a closing parenthesis
      if (index >= tokens.length || !isGroupEnd(tokens[index])) {
        throw new Error(
          `Missing closing parenthesis for group at depth ${startDepth + 1}`,
        );
      }

      groupDepth--;
      if (groupDepth === 0 && inFieldGroup) {
        inFieldGroup = false;
      }
      index++;

      return expression;
    }

    // Handle unary NOT operator
    if (isOperator(token) && token.name === 'NOT') {
      const expression = parsePrimary();

      // Avoid double negation
      if (expression.$not) {
        return expression;
      }

      return { $not: expression };
    }

    if (isField(token)) {
      const fieldName = token.name;

      if (index >= tokens.length) {
        throw new Error(`Unexpected end of query after field: ${fieldName}`);
      }

      if (inFieldGroup) {
        const msg = `Field groups cannot contain sub-fields: found field "${fieldName}"`;
        throw new Error(msg);
      }

      const valueToken = tokens[index++];

      if (fieldName === EXISTS_FIELD) {
        // special case for existence check
        if (isTermValue(valueToken)) {
          const path = valueToken.value;
          return { [path]: { $exists: true } };
        } else {
          throw new Error(
            `Expected identifier for existence check: ${getTokenType(valueToken)}`,
          );
        }
      }

      // handle simple values
      if (isTermValue(valueToken)) {
        return parseTokenValue(fieldName, valueToken.value);
      }

      if (isPhraseValue(valueToken)) {
        return { [fieldName]: valueToken.value };
      }

      if (isWildcardValue(valueToken)) {
        return buildWildcardFilter(fieldName, valueToken.value);
      }

      // Handle range values: field:[min TO max]
      if (isRangeValue(valueToken)) {
        return buildRangeFilter(fieldName, valueToken);
      }

      // Handle regex values: field:/pattern/i
      if (isRegexValue(valueToken)) {
        return buildRegexFilter(
          fieldName,
          valueToken.value,
          valueToken.ignoreCase,
        );
      }

      if (isGroupStart(valueToken)) {
        // we should only accept simple values or regexes inside field groups
        const prevInFieldGroup = inFieldGroup;
        inFieldGroup = true;
        groupedFieldName = fieldName;
        groupDepth++;

        const groupExpression = parseExpression(0);

        // Expect closing parenthesis
        if (index >= tokens.length || !isGroupEnd(tokens[index])) {
          throw new Error(
            `Missing closing parenthesis for field group: ${fieldName}`,
          );
        }

        groupDepth--;
        inFieldGroup = prevInFieldGroup;
        groupedFieldName = null;
        index++;

        // console.log('Optimized group expression:', JSON.stringify(node));
        return groupExpression;
      }

      throw new Error(
        `Invalid value token after field: ${fieldName}, ${getTokenType(valueToken)}`,
      );
    }

    // Handle simple values (something like "quick brown fox")
    // Collect consecutive simple values for text search
    const searchTerms: any[] = [];
    const regexPatterns: string[] = [];

    index--; // Rewind to process the current token
    let first = true;

    while (index < tokens.length) {
      const token = tokens[index];

      // Stop at group boundaries
      if (isGroupStart(token) || isGroupEnd(token)) {
        break;
      }

      if (isWildcardValue(token)) {
        const pattern = translateWildcards(token.value, 'fullText');
        regexPatterns.push(pattern);
        first = false;
        index++;
        continue;
      }
      if (isTermValue(token)) {
        const value = possiblyConvertValue(token.value);
        searchTerms.push(value);
        first = false;
        index++;
        continue;
      }
      if (isPhraseValue(token)) {
        searchTerms.push(token.value);
        first = false;
        index++;
        continue;
      }
      if (isRegexValue(token)) {
        const pattern = translateRegexToLuaPattern(token.value);
        regexPatterns.push(pattern);
        first = false;
        index++;
        continue;
      }
      if (first) {
        const tokenType = getTokenType(token);
        const tokenValue = getTokenValue(token);
        throw new Error(`Unexpected token: ${tokenType} - ${tokenValue}`);
      }
      break;
    }

    // NOTE: here we build a combined filter for all collected search terms and regex patterns
    // The (implicit) connection between them is AND, so we can't consolidate them into a single $contains or $regex
    // Build combined text search filter
    const filters: any[] = [];
    const fieldName = groupedFieldName || 'fullText';
    const contains = fieldName === 'fullText' || fieldName === 'logs';

    if (searchTerms.length > 0) {
      const operator = contains ? '$contains' : '$eq';
      for (const term of searchTerms) {
        const value = contains ? term.toString() : term;
        filters.push({ [fieldName]: { [operator]: value } });
      }
    }

    if (regexPatterns.length > 0) {
      for (const pattern of regexPatterns) {
        const value = pattern.toString();
        filters.push({ [fieldName]: { $regex: value } });
      }
    }

    return filters.length === 1 ? filters[0] : { $and: filters };
  }

  return parseExpression(0);
}

/**
 * Validates that parentheses are properly balanced and matched
 * @param tokens - Array of tokens to validate
 * @throws Error if parentheses are unbalanced or mismatched
 */
function validateParentheses(tokens: Token[]): void {
  let depth = 0;
  const positions: number[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (isGroupStart(token)) {
      depth++;
      positions.push(i);
    } else if (isGroupEnd(token)) {
      depth--;
      if (depth < 0) {
        throw new Error(`Unexpected closing parenthesis at position ${i}`);
      }
      positions.pop();
    }
  }

  if (depth > 0) {
    const unclosedPosition = positions[positions.length - 1];
    throw new Error(`Unclosed parenthesis at position ${unclosedPosition}`);
  }
}

/**
 * Returns operator precedence levels for Lucene semantics
 * Higher number = higher precedence
 * NOT (unary) is handled in parsePrimary, not here
 */
function getOperatorPrecedence(operator: 'AND' | 'OR' | 'NOT' | 'XOR'): number {
  switch (operator) {
    case 'OR':
    case 'XOR':
      return 1;
    case 'AND':
      return 2;
    case 'NOT':
      return 3; // NOT as a binary operator (rare)
    default:
      return 0;
  }
}

/**
 * Parses a single token value into a MongoDB condition
 */
function parseTokenValue(field: string, token: string): any {
  // Handle quoted values
  const value = possiblyConvertValue(token);

  // Check if it's a field:value pair
  if (!field?.length) {
    // No field specified, search in all fields (text search)
    return { fullText: { $contains: value.toString() } };
  }

  // Default: treat as string
  return { [field]: value };
}

const NUMBER_REGEX = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;

function parsePossibleNumber(value: string): string | number {
  // check that value has only valid number characters (for example, we can have something like 2023-01-01)
  if (NUMBER_REGEX.test(value)) {
    const lowerNum = parseFloat(value);
    return isNaN(lowerNum) ? value : lowerNum;
  }
  return value;
}

function parsePossibleBoolean(value: string): string | boolean {
  const lowerValue = value.toLowerCase();
  if (lowerValue === 'true') {
    return true;
  }
  if (lowerValue === 'false') {
    return false;
  }
  return value;
}

function possiblyConvertValue(value: string): string | number | boolean | null {
  const numValue = parsePossibleNumber(value);
  if (typeof numValue === 'string') {
    if (numValue === 'null') {
      return null;
    }
    return parsePossibleBoolean(numValue);
  }
  return numValue;
}

/**
 * Parses range queries like [value1 TO value2]
 */
function buildRangeFilter(field: string, range: RangeValue): any {
  const rangeQuery: Record<string, any> = {};

  if (range.lower && range.lower !== '*') {
    rangeQuery[range.lowerInclusive ? '$gte' : '$gt'] = parsePossibleNumber(
      range.lower,
    );
  }

  if (range.upper && range.upper !== '*') {
    rangeQuery[range.upperInclusive ? '$lte' : '$lt'] = parsePossibleNumber(
      range.upper,
    );
  }

  if (Object.keys(rangeQuery).length === 0) {
    return { [field]: { $exists: true } };
  }

  return { [field]: rangeQuery };
}

function translateWildcards(
  value: string,
  field: string | undefined = undefined,
): string {
  // Convert wildcards to regex patterns
  let pattern = value.replace(/\?/g, '.').replace(/\*/g, '.*');

  // For fullText and logs fields, do not anchor the pattern
  if (field !== 'fullText' && field !== 'logs') {
    // Add anchors if not already present
    if (!pattern.startsWith('.*')) {
      pattern = '^' + pattern;
    }

    if (!pattern.endsWith('.*')) {
      pattern = pattern + '$';
    }
  }

  return pattern;
}

function buildWildcardFilter(field: string, value: string): any {
  // Convert wildcards to regex patterns
  const pattern = translateWildcards(value, field);
  return { [field]: { $regex: pattern } };
}

/**
 * Build regex queries (between / .. /)
 */
function buildRegexFilter(
  field: string,
  value: string,
  ignoreCase = false,
): any {
  // Convert Lucene wildcards to lua regex
  let regexPattern = translateRegexToLuaPattern(value);

  // Do not anchor the pattern for log or fullText searches, since that would make not practical sense
  if (field !== 'fullText' && field !== 'logs') {
    // Ensure the pattern is anchored if it doesn't start with wildcard
    if (!regexPattern.startsWith('.*')) {
      regexPattern = '^' + regexPattern;
    }

    if (!regexPattern.endsWith('.*')) {
      regexPattern = regexPattern + '$';
    }
  }

  return {
    [field]: {
      $regex: regexPattern,
      ...(ignoreCase && { $options: 'i' }),
    },
  };
}

/**
 * Optimizes MongoDB-style queries by coalescing nested operators and simplifying conditions
 * @param query - The query object to optimize
 * @returns Optimized query object
 */
export function optimizeQuery(query: any): any {
  if (!query || typeof query !== 'object') {
    return query;
  }

  // Handle $or operator
  if (query.$or) {
    return optimizeOrCondition(query.$or);
  }

  // Handle $and operator
  if (query.$and) {
    return optimizeAndCondition(query.$and);
  }

  // Handle $not operator
  if (query.$not) {
    return { $not: optimizeQuery(query.$not) };
  }

  return query;
}

/**
 * Optimizes conditions by flattening nested values for a given connector ($and or $or)
 */
function coalesceCondition(
  conditions: any[],
  connector: '$and' | '$or' = '$and',
): ServerQuery {
  const flattened: any[] = [];

  // Flatten nested $and
  for (const condition of conditions) {
    const optimized = optimizeQuery(condition);

    // Flatten nested connectors
    if (optimized[connector]) {
      flattened.push(...optimized[connector]);
    } else {
      flattened.push(optimized);
    }
  }

  // handle $and

  if (flattened.length === 1) {
    return flattened[0];
  }

  return { [connector]: flattened };
}

/**
 * Optimizes $and conditions by flattening nested $and
 */
function optimizeAndCondition(conditions: any[]): ServerQuery {
  return coalesceCondition(conditions, '$and');
}

/**
 * Optimizes $or conditions by flattening nested $or and coalescing $text searches
 */
function optimizeOrCondition(conditions: any[]): ServerQuery {
  return coalesceCondition(conditions, '$or');
}

// Simple regex pattern to identify wildcard characters
const SimpleRegexPattern = /[+*?]/;

const JS_RANGE_TO_LUA_MAP: Record<string, string> = {
  'a-zA-Z0-9': '%w',
  'A-Za-z0-9': '%w',
  '0-9a-zA-Z': '%w',
  '0-9A-Za-z': '%w',
  '0-9a-fA-F': '%x',
  'a-fA-F0-9': '%x',
  'a-zA-Z': '%a',
  'A-Za-z': '%a',
  '0-9': '%d',
  'a-z': '%l',
  'A-Z': '%u',
};

/**
 * Translates standard regex character classes into equivalent Lua patterns
 * @returns The equivalent Lua pattern character class
 */
function translateRegexClassToLua(regexClass: string): string {
  // Translate character classes using the mapping
  for (const [clazz, luaClass] of Object.entries(JS_RANGE_TO_LUA_MAP)) {
    const regex = new RegExp(clazz, 'g');
    regexClass = regexClass.replace(regex, luaClass);
  }

  // Translate character classes using the mapping
  for (const [clazz, luaClass] of Object.entries(
    REGEX_TO_LUA_CHARACTER_CLASSES,
  )) {
    const regex = new RegExp(clazz.replace(/\\/g, '\\\\'), 'g');
    regexClass = regexClass.replace(regex, luaClass);
  }

  return regexClass;
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

  let luaPattern = regexPattern.replace(/\*/g, '.*').replace(/\?/g, '.');

  // Translate character classes using the mapping
  for (const [regexClass, luaClass] of Object.entries(
    REGEX_TO_LUA_CHARACTER_CLASSES,
  )) {
    const regex = new RegExp(regexClass.replace(/\\/g, '\\\\'), 'g');
    luaPattern = luaPattern.replace(regex, luaClass);
  }

  // Recursively translate nested character sets
  // Limit the content to reasonable lengths and use atomic grouping concept
  luaPattern = luaPattern.replace(
    /\[([^\]]{0,100}?)]/g,
    function (match, _innerContent: string) {
      return translateRegexClassToLua(match);
    },
  );

  // Escape special Lua pattern characters that might conflict
  luaPattern = luaPattern.replace(/([%.%+%*%?%^%$%(%)%[%]%{%}])/g, '%%$1');

  return luaPattern;
}
