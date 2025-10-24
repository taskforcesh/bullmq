// lucene-to-mongo.test.ts
import { parseSearchQuery } from '../src';
import { describe, it } from 'mocha';
import { expect } from 'chai';

 
describe('parseSearchQuery', () => {
  describe('Empty and invalid queries', () => {
    it('should return empty object for empty query', () => {
      expect(parseSearchQuery('')).to.eql({});
    });

    it('should return empty object for whitespace-only query', () => {
      expect(parseSearchQuery('   ')).to.eql({});
    });

    it('should return empty object for null query', () => {
      expect(parseSearchQuery(null as any)).to.eql({});
    });

    it('should return empty object for undefined query', () => {
      expect(parseSearchQuery(undefined as any)).to.eql({});
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
      const result = parseSearchQuery('name:John AND age:25 AND status:active');
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
      const result = parseSearchQuery('name:(John OR Jane) AND age:(25 OR 30)');
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

    it('should handle wildcard at the beginning only', () => {
      const result = parseSearchQuery('email:*@example.com');
      expect(result).to.be.eql({
        email: { $regex: '.*@example.com$' },
      });
    });

    it('should handle wildcard at the end only', () => {
      const result = parseSearchQuery('email:user@*');
      expect(result).to.be.eql({
        email: { $regex: '^user@.*' },
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

    it('should handle multiple fields with wildcards', () => {
      const result = parseSearchQuery('firstName:Jo* AND lastName:*son');
      expect(result).to.be.eql({
        $and: [
          { firstName: { $regex: '^Jo.*' } },
          { lastName: { $regex: '.*son$' } },
        ],
      });
    });

    it('should handle wildcards with OR operator', () => {
      const result = parseSearchQuery('status:pend* OR status:wait*');
      expect(result).to.be.eql({
        $or: [
          { status: { $regex: '^pend.*' } },
          { status: { $regex: '^wait.*' } },
        ],
      });
    });

    it('should handle wildcards with NOT operator', () => {
      const result = parseSearchQuery('NOT status:fail*');
      expect(result).to.be.eql({
        $not: { status: { $regex: '^fail.*' } },
      });
    });

    it('should handle wildcards in grouped expressions', () => {
      const result = parseSearchQuery(
        '(name:Jo* OR name:Jane*) AND status:active',
      );
      expect(result).to.be.eql({
        $and: [
          {
            $or: [
              { name: { $regex: '^Jo.*' } },
              { name: { $regex: '^Jane.*' } },
            ],
          },
          { status: 'active' },
        ],
      });
    });

    it('should handle wildcards with nested groups', () => {
      const result = parseSearchQuery(
        '((firstName:J* OR firstName:K*) AND lastName:*son) OR email:*@test.com',
      );
      expect(result).to.be.eql({
        $or: [
          {
            $and: [
              {
                $or: [
                  { firstName: { $regex: '^J.*' } },
                  { firstName: { $regex: '^K.*' } },
                ],
              },
              { lastName: { $regex: '.*son$' } },
            ],
          },
          { email: { $regex: '.*@test.com$' } },
        ],
      });
    });

    it('should handle consecutive wildcards', () => {
      const result = parseSearchQuery('name:a**b');
      expect(result).to.be.eql({
        name: { $regex: '^a.*.*b$' },
      });
    });

    it('should handle consecutive question marks', () => {
      const result = parseSearchQuery('code:???');
      expect(result).to.be.eql({
        code: { $regex: '^...$' },
      });
    });

    it('should handle wildcard with empty string before star', () => {
      const result = parseSearchQuery('tag:*tag');
      expect(result).to.be.eql({
        tag: { $regex: '.*tag$' },
      });
    });

    it('should handle wildcard with empty string after star', () => {
      const result = parseSearchQuery('tag:tag*');
      expect(result).to.be.eql({
        tag: { $regex: '^tag.*' },
      });
    });

    it('should handle complex wildcard patterns', () => {
      const result = parseSearchQuery('filename:test_*_??.log');
      expect(result).to.be.eql({
        filename: { $regex: '^test_.*_...log$' },
      });
    });

    it('should handle wildcards combined with range queries', () => {
      const result = parseSearchQuery('name:Jo* AND age:[25 TO 35]');
      expect(result).to.be.eql({
        $and: [{ name: { $regex: '^Jo.*' } }, { age: { $gte: 25, $lte: 35 } }],
      });
    });

    it('should handle wildcards combined with exact matches', () => {
      const result = parseSearchQuery('department:eng* AND status:active');
      expect(result).to.be.eql({
        $and: [{ department: { $regex: '^eng.*' } }, { status: 'active' }],
      });
    });

    it('should handle wildcards with numeric field names', () => {
      const result = parseSearchQuery('id:user_*');
      expect(result).to.be.eql({
        id: { $regex: '^user_.*' },
      });
    });

    it('should handle wildcards with dots in field names', () => {
      const result = parseSearchQuery('data.name:test*');
      expect(result).to.be.eql({
        'data.name': { $regex: '^test.*' },
      });
    });

    it('should handle wildcards without field (text search)', () => {
      const result = parseSearchQuery('test*');
      expect(result).to.be.eql({
        fullText: { $regex: '^test.*' },
      });
    });

    it('should handle multiple wildcards without field', () => {
      const result = parseSearchQuery('foo* bar?');
      expect(result).to.be.eql({
        $and: [
          { fullText: { $regex: '^foo.*' } },
          { fullText: { $regex: '^bar.$' } },
        ],
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

    it('should handle wildcards in complex boolean expressions', () => {
      const result = parseSearchQuery(
        '(name:John* AND status:act*) OR (name:Jane* AND status:pend*)',
      );
      expect(result).to.be.eql({
        $or: [
          {
            $and: [
              { name: { $regex: '^John.*' } },
              { status: { $regex: '^act.*' } },
            ],
          },
          {
            $and: [
              { name: { $regex: '^Jane.*' } },
              { status: { $regex: '^pend.*' } },
            ],
          },
        ],
      });
    });

    it('should handle wildcards with numeric values', () => {
      const result = parseSearchQuery('code:123*');
      expect(result).to.be.eql({
        code: { $regex: '^123.*' },
      });
    });

    it('should handle wildcards at both ends', () => {
      const result = parseSearchQuery('tag:*important*');
      expect(result).to.be.eql({
        tag: { $regex: '.*important.*' },
      });
    });

    it('should handle single character wildcard in complex pattern', () => {
      const result = parseSearchQuery('code:A?-B?-C?');
      expect(result).to.be.eql({
        code: { $regex: '^A.-B.-C.$' },
      });
    });
  });

  describe('Regex queries', () => {
    it('should handle basic regex pattern', () => {
      const result = parseSearchQuery('name:/john/');
      expect(result).to.haveOwnProperty('name');
      expect(result.name).to.haveOwnProperty('$regex');
      expect(result.name.$regex).to.eql('^john$');
    });

    it('should handle regex with ignore case', () => {
      const result = parseSearchQuery('name:/foo-[bar]/i');
      expect(result).to.haveOwnProperty('name');
      expect(result.name).to.haveOwnProperty('$regex');
      expect(result.name).to.haveOwnProperty('$options');
      expect(result.name.$options).to.eql('i');
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
      const result = parseSearchQuery('name:John status:active');
      expect(result).to.be.eql({
        $and: [{ name: 'John' }, { status: 'active' }],
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
