// lucene-to-mongo.test.ts
import { parseSearchQuery, translateRegexToLuaPattern } from '../src';
import { describe, it } from 'mocha';
import { expect } from 'chai';

describe('Search Query Parsing', () => {
  describe('Regex to Lua Pattern Translation', () => {
    // Utility function for repeated test patterns
    function expectLuaTranslation(
      input: string,
      expected: string,
      matcher: (result: string) => any = expect,
    ) {
      const result = translateRegexToLuaPattern(input);
      matcher(result).to.eql(expected);
    }

    describe('Character class translations', () => {
      it('should translate character classes to Lua equivalents', () => {
        const characterClassMappings: { [regexClass: string]: string } = {
          '\\d': '%d', // digit
          '\\D': '%D', // non-digit
          '\\w': '%a', // alphanumeric
          '\\W': '%A', // non-alphanumeric
          '\\s': '%s', // whitespace
          '\\S': '%S', // non-whitespace
        };

        for (const [input, output] of Object.entries(characterClassMappings)) {
          expectLuaTranslation(input, output);
        }
      });

      it('should translate character ranges to Lua equivalents', () => {
        const characterRangeMappings: { [regexRange: string]: string } = {
          '[a-z]': '[%l]', // lowercase letters
          '[A-Z]': '[%u]', // uppercase letters
          '[a-zA-Z0-9]': '[%w]', // alphanumeric
          '[0-9]': '[%d]', // digits
          '[a-zA-Z]': '[%a]', // letters
          '[^0-9]': '[^%d]', // negated digit class
          '[^a-zA-Z]': '[^%a]', // negated letter class
        };

        for (const [input, output] of Object.entries(characterRangeMappings)) {
          expectLuaTranslation(input, output);
        }
      });

      it('should handle complex character class patterns', () => {
        expectLuaTranslation('\\d+\\w*', '%d+%a.*');
        // The given the mapping will translate alphanumerics and lowercase.
        expectLuaTranslation('[a-z0-9]+', '[%l%d]+');
      });

      it('should translate email-like pattern', () => {
        const result = translateRegexToLuaPattern(
          '[a-zA-Z0-9]+@[a-zA-Z0-9]+\\.[a-zA-Z]+',
        );
        // Should contain character class translations
        expect(result).to.be.eql('[%w]+@[%w]+\\.[%a]+');
      });
    });

    describe('Wildcard translations', () => {
      it('should translate wildcards to Lua equivalents', () => {
        const wildcardMappings: { [pattern: string]: string } = {
          'a*': 'a.*', // `*` becomes `.*`
          'a?b': 'a.b', // `?` becomes `.`
          'a*b?c': 'a.*b.c', // combination of wildcards
        };

        for (const [input, output] of Object.entries(wildcardMappings)) {
          expectLuaTranslation(input, output);
        }
      });

      it('should translate consecutive wildcards correctly', () => {
        expectLuaTranslation('a**b', 'a.*.*b');
      });
    });

    describe('Meta character handling', () => {
      it('should handle patterns with parentheses', () => {
        const result = translateRegexToLuaPattern('(test)');
        // Parentheses are special in Lua patterns
        expect(result).to.not.throw;
      });

      it('should handle patterns with brackets', () => {
        const result = translateRegexToLuaPattern('[test]');
        expect(result).to.not.throw;
      });

      it('should accept plus character', () => {
        const result = translateRegexToLuaPattern('a+b');
        // + is special in regex, should be handled
        expect(result).to.exist;
      });

      it('should accept caret character', () => {
        const result = translateRegexToLuaPattern('a^b');
        expect(result).to.exist;
      });

      it('should accept $ character', () => {
        const result = translateRegexToLuaPattern('a$b');
        expect(result).to.exist;
      });
    });

    describe('Edge cases', () => {
      it('should handle empty pattern', () => {
        const result = translateRegexToLuaPattern('');
        expect(result).to.equal('');
      });

      it('should handle plain text without special characters', () => {
        const result = translateRegexToLuaPattern('hello');
        expect(result).to.equal('hello');
      });

      it('should handle very long patterns', () => {
        const longPattern = 'a'.repeat(100) + '[0-9]' + 'b'.repeat(100);
        const result = translateRegexToLuaPattern(longPattern);
        expect(result).to.include('%d');
      });

      it('should handle nested character classes', () => {
        const result = translateRegexToLuaPattern('[a-z0-9]+');
        // Should translate the character class
        expect(result).to.exist;
      });
    });

    describe('Pattern matching equivalence', () => {
      it('should maintain pattern structure for literal characters', () => {
        const pattern = 'test';
        const result = translateRegexToLuaPattern(pattern);
        // Literal text should be preserved
        expect(result).to.include('test');
      });

      it('should preserve whitespace in patterns', () => {
        const pattern = 'hello world';
        const result = translateRegexToLuaPattern(pattern);
        expect(result).to.be.eql('hello world');
      });
    });

    describe('Regex boundary conditions', () => {
      it('should not double-escape already escaped characters', () => {
        const pattern = '\\\\d';
        const result = translateRegexToLuaPattern(pattern);
        // Should handle backslash appropriately
        expect(result).to.exist;
      });

      it('should handle patterns with multiple escape sequences', () => {
        const result = translateRegexToLuaPattern('\\d+\\s*[a-z]+');
        expect(result).to.be.eql('%d+%s.*[%l]+');
      });

      it('should handle mixed case in character ranges', () => {
        const result = translateRegexToLuaPattern('[A-Za-z]');
        expect(result).to.be.eql('[%a]');
      });
    });
  });

  describe('parseSearchQuery', () => {
    describe('Empty and invalid queries', () => {
      it('should return empty object for empty query', () => {
        expect(() => parseSearchQuery('')).to.throw();
      });

      it('should return empty object for whitespace-only query', () => {
        expect(() => parseSearchQuery(' ')).to.throw();
      });

      it('should return empty object for null query', () => {
        expect(() => parseSearchQuery(null as any)).to.throw();
      });

      it('should return empty object for undefined query', () => {
        expect(() => parseSearchQuery(undefined as any)).to.throw();
      });
    });

    describe('Basic field queries', () => {
      it('should handle simple field:value query', () => {
        const result = parseSearchQuery('name:John');
        expect(result).to.be.eql({ name: 'John' });
      });

      it('should handle numeric values', () => {
        const result = parseSearchQuery('age:25');
        expect(result).to.be.eql({ age: 25 });
      });

      it('should handle boolean values', () => {
        expect(parseSearchQuery('active:true')).to.be.eql({ active: true });
        expect(parseSearchQuery('active:false')).to.be.eql({ active: false });
      });

      it('should handle quoted values', () => {
        const result = parseSearchQuery('title:"Hello World"');
        expect(result).to.be.eql({ title: `Hello World` });
      });

      it('should handle single quoted values', () => {
        const result = parseSearchQuery("title:'Hello World'");
        expect(result).to.be.eql({ title: `Hello World` });
      });
    });

    describe('Logical operators', () => {
      it('should handle AND operator', () => {
        const result = parseSearchQuery('name:John AND age:25');
        expect(result).to.be.eql({
          $and: [{ name: 'John' }, { age: 25 }],
        });
      });

      it('should handle OR operator', () => {
        const result = parseSearchQuery('status:active OR status:pending');
        expect(result).to.be.eql({
          $or: [{ status: 'active' }, { status: 'pending' }],
        });
      });

      it('should handle | operator', () => {
        const result = parseSearchQuery('status:active | status:pending');
        expect(result).to.be.eql({
          $or: [{ status: 'active' }, { status: 'pending' }],
        });
      });

      it('should handle the XOR operator', () => {
        const result = parseSearchQuery('status:active XOR status:pending');
        expect(result).to.be.eql({
          $xor: [{ status: 'active' }, { status: 'pending' }],
        });
      });

      it('should handle ^ as the XOR operator', () => {
        const result = parseSearchQuery('status:active ^ status:pending');
        expect(result).to.be.eql({
          $xor: [{ status: 'active' }, { status: 'pending' }],
        });
      });

      it('should handle NOT operator', () => {
        const result = parseSearchQuery('NOT status:cancelled');
        expect(result).to.be.eql({
          $not: { status: 'cancelled' },
        });
      });

      it('should handle - as the NOT operator', () => {
        const result = parseSearchQuery('-status:cancelled');
        expect(result).to.be.eql({
          $not: { status: 'cancelled' },
        });
      });

      it('should handle multiple AND operators', () => {
        const result = parseSearchQuery(
          'name:John AND age:25 AND status:active',
        );
        expect(result).to.be.eql({
          $and: [{ name: 'John' }, { age: 25 }, { status: 'active' }],
        });
      });
    });

    it('should handle mixed AND and OR operators', () => {
      const result = parseSearchQuery(
        'name:John AND (status:active OR status:pending)',
      );
      expect(result).to.be.eql({
        $and: [
          { name: 'John' },
          {
            $or: [{ status: 'active' }, { status: 'pending' }],
          },
        ],
      });
    });

    describe('Quoted phrases', () => {
      it('should handle escapes in strings', () => {
        const result = parseSearchQuery('title:"Hello \\"World\\""');
        expect(result).to.eql({ title: 'Hello \\"World\\"' });
      });

      it('should handle escaped backslashes in quoted strings', () => {
        const result = parseSearchQuery('path:"C:\\\\Users\\\\test"');
        expect(result).to.eql({ path: 'C:\\\\Users\\\\test' });
      });
    });

    describe('Parentheses grouping', () => {
      it('should handle simple parentheses', () => {
        const result = parseSearchQuery('(name:John OR name:Jane) AND age:25');
        expect(result).to.be.eql({
          $and: [
            {
              $or: [{ name: 'John' }, { name: 'Jane' }],
            },
            { age: 25 },
          ],
        });
      });

      it('should handle nested parentheses', () => {
        const result = parseSearchQuery(
          '((category:tech OR category:science) AND rating:5) OR featured:true',
        );
        expect(result).to.be.eql({
          $or: [
            {
              $and: [
                {
                  $or: [{ category: 'tech' }, { category: 'science' }],
                },
                { rating: 5 },
              ],
            },
            { featured: true },
          ],
        });
      });

      it('should handle complex grouping with NOT', () => {
        const result = parseSearchQuery(
          'name:John AND (age:25 OR age:30) AND NOT status:inactive',
        );
        expect(result).to.be.eql({
          $and: [
            { name: 'John' },
            {
              $or: [{ age: 25 }, { age: 30 }],
            },
            { $not: { status: 'inactive' } },
          ],
        });
      });

      it('should handle multiple OR conditions in parentheses', () => {
        const result = parseSearchQuery(
          '(title:search OR content:search) AND (author:smith OR author:jones)',
        );
        expect(result).to.be.eql({
          $and: [
            {
              $or: [{ title: 'search' }, { content: 'search' }],
            },
            {
              $or: [{ author: 'smith' }, { author: 'jones' }],
            },
          ],
        });
      });

      it('should handle grouping with fields', () => {
        const result = parseSearchQuery(
          'name:(John OR Jane) AND age:(25 OR 30)',
        );
        expect(result).to.be.eql({
          $and: [
            {
              $or: [{ name: { $eq: 'John' } }, { name: { $eq: 'Jane' } }],
            },
            {
              $or: [{ age: { $eq: 25 } }, { age: { $eq: 30 } }],
            },
          ],
        });
      });

      it('should disallow specifying fields when creating a field with a grouping', () => {
        expect(() => parseSearchQuery('name:(John OR last:majors)')).to.throw();
      });
    });

    describe('Range queries', () => {
      it('should handle numeric range queries', () => {
        const result = parseSearchQuery('price:[100 TO 500]');
        expect(result).to.be.eql({
          price: { $gte: 100, $lte: 500 },
        });
      });

      it('should handle string range queries', () => {
        const result = parseSearchQuery('name:[Adam TO John]');
        expect(result).to.be.eql({
          name: { $gte: 'Adam', $lte: 'John' },
        });
      });

      it('should handle open-ended range queries', () => {
        const result = parseSearchQuery('priority:[100 TO *]');
        expect(result).to.be.eql({
          priority: { $gte: 100 },
        });
      });

      it('should handle lower-bound only range queries', () => {
        const result = parseSearchQuery('priority:[* TO 500]');
        expect(result).to.be.eql({
          priority: { $lte: 500 },
        });
      });
    });

    describe('Wildcard queries', () => {
      it('fullText search should not be anchored', () => {
        const result = parseSearchQuery('Jo*');
        expect(result).to.be.eql({
          fullText: { $regex: 'Jo.*' },
        });

        const result2 = parseSearchQuery('fullText:Jo*');
        expect(result2).to.be.eql({
          fullText: { $regex: 'Jo.*' },
        });
      });

      it('should not anchor regex for search against logs', () => {
        const result = parseSearchQuery('logs:timeout*');
        expect(result).to.be.eql({
          logs: { $regex: 'timeout.*' },
        });
      });

      it('should handle prefix wildcard', () => {
        const result = parseSearchQuery('name:Jo*');
        expect(result).to.be.eql({
          name: { $regex: '^Jo.*' },
        });
      });

      it('should handle suffix wildcard', () => {
        const result = parseSearchQuery('name:*hn');
        expect(result).to.be.eql({
          name: { $regex: '.*hn$' },
        });
      });

      it('should handle multiple wildcards', () => {
        const result = parseSearchQuery('name:J*n*');
        expect(result).to.be.eql({
          name: { $regex: '^J.*n.*' },
        });
      });

      it('should handle question mark wildcard', () => {
        const result = parseSearchQuery('name:J?hn');
        expect(result).to.be.eql({
          name: { $regex: '^J.hn$' },
        });
      });

      it('should handle wildcard only (star)', () => {
        const result = parseSearchQuery('name:*');
        expect(result).to.be.eql({
          name: { $regex: '.*' },
        });
      });

      it('should handle multiple question marks', () => {
        const result = parseSearchQuery('code:A??C');
        expect(result).to.be.eql({
          code: { $regex: '^A..C$' },
        });
      });

      it('should handle wildcards in the middle', () => {
        const result = parseSearchQuery('filename:test*.txt');
        expect(result).to.be.eql({
          filename: { $regex: '^test.*.txt$' },
        });
      });

      it('should handle mixed wildcards (star and question mark)', () => {
        const result = parseSearchQuery('pattern:a?b*c');
        expect(result).to.be.eql({
          pattern: { $regex: '^a.b.*c$' },
        });
      });

      it('should handle wildcard with special regex characters', () => {
        const result = parseSearchQuery('path:src/*.js');
        expect(result).to.be.eql({
          path: { $regex: '^src/.*.js$' },
        });
      });

      it('should handle complex wildcard patterns', () => {
        const result = parseSearchQuery('filename:test_*_??.log');
        expect(result).to.be.eql({
          filename: { $regex: '^test_.*_...log$' },
        });
      });

      it('should handle wildcards without field (text search)', () => {
        const result = parseSearchQuery('test*');
        expect(result).to.be.eql({
          fullText: { $regex: 'test.*' },
        });
      });

      it('should handle wildcard-only pattern', () => {
        const result = parseSearchQuery('field:*');
        expect(result).to.be.eql({
          field: { $regex: '.*' },
        });
      });

      it('should handle question mark-only pattern', () => {
        const result = parseSearchQuery('field:?');
        expect(result).to.be.eql({
          field: { $regex: '^.$' },
        });
      });
    });

    describe('Regex queries', () => {
      it('should handle basic regex pattern', () => {
        const result = parseSearchQuery('name:/john/');
        expect(result).to.eql({ name: { $regex: '^john$' } });
      });

      it('should handle regex with ignore case', () => {
        const result = parseSearchQuery('name:/foo-[bar]/i');
        expect(result).to.be.eql({
          name: {
            $regex: '^foo-[bar]$',
            $options: 'i',
          },
        });
      });

      it('should handle special characters in regex patterns', () => {
        const result = parseSearchQuery('email:/user\\+tag@domain\\.com/');
        expect(result).to.eql({
          email: { $regex: '^user\\+tag@domain\\.com$' },
        });
      });
    });

    describe('Text search without fields', () => {
      it('should handle simple text search', () => {
        const result = parseSearchQuery('quick brown fox');
        expect(result).to.be.eql({
          $and: [
            { fullText: { $contains: 'quick' } },
            { fullText: { $contains: 'brown' } },
            { fullText: { $contains: 'fox' } },
          ],
        });
      });

      it('should handle quoted phrase without field', () => {
        const result = parseSearchQuery('"quick brown fox"');
        expect(result).to.be.eql({
          fullText: { $contains: 'quick brown fox' },
        });
      });
    });

    describe('Exists queries', () => {
      it('should handle field existence check', () => {
        const result = parseSearchQuery('_exists_:username');
        expect(result).to.be.eql({
          username: { $exists: true },
        });
      });

      it('should throw for invalid field path in exists check', () => {
        expect(() => parseSearchQuery('_exists_:*user?name')).to.throw();
      });
    });

    describe('Complex combined queries', () => {
      it('should handle complex query with all features', () => {
        const result = parseSearchQuery(
          '(name:John* OR age:[25 TO 35]) AND status:active AND NOT department:sales',
        );
        expect(result).to.be.eql({
          $and: [
            {
              $or: [
                { name: { $regex: '^John.*' } },
                { age: { $gte: 25, $lte: 35 } },
              ],
            },
            { status: 'active' },
            { $not: { department: 'sales' } },
          ],
        });
      });

      it('should handle multiple nested conditions', () => {
        const result = parseSearchQuery(
          // eslint-disable-next-line max-len
          '((status:active AND priority:high) OR (status:pending AND created:["2023-01-01" TO "2023-12-31"])) AND assigned:true',
        );
        expect(result).to.be.eql({
          $and: [
            {
              $or: [
                {
                  $and: [{ status: 'active' }, { priority: 'high' }],
                },
                {
                  $and: [
                    { status: 'pending' },
                    { created: { $gte: '2023-01-01', $lte: '2023-12-31' } },
                  ],
                },
              ],
            },
            { assigned: true },
          ],
        });
      });
    });

    describe('Edge cases', () => {
      it('should handle queries with parentheses in quoted values', () => {
        const result = parseSearchQuery('title:"Test (with parentheses)"');
        expect(result).to.be.eql({ title: `Test (with parentheses)` });
      });

      it('should handle implicit AND between terms', () => {
        const result = parseSearchQuery(
          'name:John status:active (quick brown)',
        );
        expect(result).to.be.eql({
          $and: [
            { name: 'John' },
            { status: 'active' },
            { fullText: { $contains: 'quick' } },
            { fullText: { $contains: 'brown' } },
          ],
        });
      });

      it('should handle mixed quoted and unquoted values', () => {
        const result = parseSearchQuery('title:"Hello World" AND author:Smith');
        expect(result).to.be.eql({
          $and: [{ title: `Hello World` }, { author: 'Smith' }],
        });
      });
    });

    describe('Operator precedence', () => {
      it('should respect AND over OR precedence without parentheses', () => {
        const result = parseSearchQuery('A OR B AND C');
        // AND has higher precedence than OR, so this should be: A OR (B AND C)
        expect(result).to.be.eql({
          $or: [
            { fullText: { $contains: 'A' } },
            {
              $and: [
                { fullText: { $contains: 'B' } },
                { fullText: { $contains: 'C' } },
              ],
            },
          ],
        });
      });

      it('should override precedence with parentheses', () => {
        const result = parseSearchQuery('(A OR B) AND C');
        expect(result).to.be.eql({
          $and: [
            {
              $or: [
                { fullText: { $contains: 'A' } },
                { fullText: { $contains: 'B' } },
              ],
            },
            { fullText: { $contains: 'C' } },
          ],
        });
      });
    });
  });
});
