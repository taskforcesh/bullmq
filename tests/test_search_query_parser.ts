// lucene-to-mongo.test.ts
import { parseSearchQuery, translateRegexToLuaPattern } from '../src';
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

    it('should handle NOT operator', () => {
      const result = parseSearchQuery('NOT status:cancelled');
      expect(result).to.be.eql({
        $not: { status: 'cancelled' },
      });
    });

    it('should handle multiple AND operators', () => {
      const result = parseSearchQuery('name:John AND age:25 AND status:active');
      console.log(JSON.stringify(result));
      expect(result).to.be.eql({
        $and: [{ name: 'John' }, { age: 25 }, { status: 'active' }],
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
        $text: { $search: ['quick', 'brown', 'fox'] },
      });
    });

    it('should handle quoted phrase without field', () => {
      const result = parseSearchQuery('"quick brown fox"');
      expect(result).to.be.eql({
        $text: { $search: '"quick brown fox"' },
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
      console.log('result: ', JSON.stringify(result));
      // AND has higher precedence than OR, so this should be: A OR (B AND C)
      expect(result).to.be.eql({
        $or: [
          { $text: { $search: 'A' } },
          {
            $and: [{ $text: { $search: 'B' } }, { $text: { $search: 'C' } }],
          },
        ],
      });
    });

    it('should override precedence with parentheses', () => {
      const result = parseSearchQuery('(A OR B) AND C');
      expect(result).to.be.eql({
        $and: [
          {
            $or: [{ $text: { $search: 'A' } }, { $text: { $search: 'B' } }],
          },
          { $text: { $search: 'C' } },
        ],
      });
    });
  });
});
