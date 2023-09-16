/*eslint-env node */
'use strict';

import { expect } from 'chai';
import { default as IORedis } from 'ioredis';
import { afterEach, beforeEach, describe, it } from 'mocha';
import { v4 } from 'uuid';
import { Job, Queue } from '../src/classes';
import { removeAllQueueData } from '../src/utils';

const Person: Record<string, any> = {
  _id: '100',
  firstName: 'Francis',
  lastName: 'Asante',
  username: 'kofrasa',
  title: 'Software Engineer',
  degree: 'Computer Science',
  jobs: 6,
  height: 1.7,
  isActive: true,
  date: {
    year: 2013,
    month: 9,
    day: 25,
  },
  languages: {
    spoken: ['english', 'french', 'spanish'],
    programming: ['C', 'Python', 'Scala', 'Java', 'Javascript', 'Bash', 'C#'],
  },
  circles: {
    school: [
      'Kobby',
      'Henry',
      'Kanba',
      'Nana',
      'Albert',
      'Yayra',
      'Linda',
      'Sophia',
    ],
    work: ['Kobby', 'KT', 'Evans', 'Robert', 'Ehi', 'Ebo', 'KO'],
    family: ['Richard', 'Roseline', 'Michael', 'Rachel'],
  },
  projects: {
    C: ['word_grid', 'student_record', 'calendar'],
    Java: ['Easy Programming Language', 'SurveyMobile'],
    Python: ['Kasade', 'Code Jam', 'Flaskapp', 'FlaskUtils'],
    Scala: [],
    Javascript: ['mingo', 'Backapp', 'BackboneApp', 'Google Election Maps'],
  },
  grades: [
    { grade: 92, mean: 88, std: 8 },
    { grade: 78, mean: 90, std: 5 },
    { grade: 88, mean: 85, std: 3 },
  ],
  retirement: null,
  today: '1970-01-01',
};

describe('getJobsByFilter', () => {
  let queue: Queue;
  const connection = { host: 'localhost' };
  let queueName: string;

  beforeEach(async () => {
    queueName = `search-test-${v4()}`;
    queue = new Queue(queueName, { connection });
    await queue.waitUntilReady();
  });

  afterEach(async () => {
    await queue.close();
    await removeAllQueueData(new IORedis(), queueName);
  });

  async function find(
    arr: Record<string, any>[],
    criteria: Record<string, any>,
  ): Promise<any[]> {
    const bulkData = arr.map(item => {
      return { name: 'search', data: item };
    });
    await queue.addBulk(bulkData);
    const { jobs } = await queue.getJobsByFilter('waiting', criteria, 0, 100);
    return jobs.map(job => job.data);
  }

  async function checkExpressionByList(
    data: Record<string, any>[],
    query: Record<string, any>,
    filterFn: (arg0: any) => boolean = () => true,
    sortBy: string = null,
  ): Promise<void> {
    // were checking expression operators, so transform query
    const criteria = { $expr: query };
    let result = await find(data, criteria);
    let expected = data.filter(filterFn);
    if (sortBy) {
      const compare = (a: Record<string, any>, b: Record<string, any>) => {
        const a2 = a[sortBy];
        const b2 = b[sortBy];
        return a2 === b2 ? 0 : a2 < b2 ? 1 : -1;
      };
      result = result.sort(compare);
      expected = expected.sort(compare);
    }

    expect(result).to.eql(expected);
  }

  async function findFirst(
    arr: Record<string, any>[],
    criteria: Record<string, any>,
  ): Promise<Record<string, any>> {
    const data = await find(arr, criteria);
    return data?.length ? data[0] : null;
  }

  async function attempt(
    criteria: Record<string, any>,
    expectMatch = true,
  ): Promise<void> {
    const { jobs } = await queue.getJobsByFilter('waiting', criteria, 0);
    expect(!!jobs.length).to.equal(expectMatch);
  }

  async function checkExpression(
    expression: Record<string, any>,
    expectedValue: any,
    expectMatch = true,
  ) {
    const criteria = { $expr: { $eq: [expression, expectedValue] } };
    await attempt(criteria, expectMatch);
  }

  function testExpressionCases(operator: string, cases: any[][]) {
    for (const [args, expected] of cases) {
      const data: Record<string, any> = {};
      const condition: Record<string, any> = {};

      if (Array.isArray(args) && args.length == 2) {
        data['first'] = args[0];
        data['second'] = args[1];
        condition[operator] = ['$data.first', '$data.second'];
      } else {
        data['value'] = args;
        condition[operator] = '$data.value';
      }

      it(`${operator}: ${JSON.stringify(args)} => ${expected}`, async () => {
        await queue.add('search', data);
        await checkExpression(condition, expected);
      });
    }
  }

  describe('Basic field access', () => {
    beforeEach(async () => {
      await queue.add('search-basic', Person);
    });

    it('can access basic job fields', async () => {
      await attempt({ name: { $exists: true } });
      await attempt({ timestamp: { $exists: true } });
      await attempt({ data: { $exists: true } });
      await attempt({ opts: { $exists: true } });
    });

    // eslint-disable-next-line mocha/no-exclusive-tests
    it('accepts simple json documents', async () => {
      await attempt({ 'data.firstName': 'Francis', 'data.isActive': true });
    });
  });

  describe('computed job fields', () => {
    let job: Job;

    beforeEach(async () => {
      job = await queue.add('search-compuuted-fields', Person);
    });

    async function updateJob(data: Record<string, any>) {
      const client = await queue.client;
      const key = job.toKey(job.id);
      await client.hmset(key, data);
    }

    it('can filter on job runtime', async () => {
      await updateJob({ finishedOn: 10000, processedOn: 5000 });
      await attempt({ runtime: { $eq: 5000 } });
    });

    it('can filter on job responseTime', async () => {
      const timestamp = job.timestamp;
      await updateJob({ finishedOn: 10000 + timestamp });
      await attempt({ responseTime: { $gt: 5000 } });
    });

    it('can filter on job waitTime', async () => {
      const timestamp = job.timestamp;
      await updateJob({ processedOn: 10000 + timestamp });
      await attempt({ waitTime: { $lt: 25000 } });
    });
  });

  describe('Comparison, Evaluation, and Element Operators', () => {
    beforeEach(async () => {
      await queue.add('search-operators', Person);
    });

    it('$eq', async () => {
      await attempt({ 'data.firstName': 'Francis' });
      await attempt({ 'data.firstName': { $eq: 'Francis' } });
    });

    it('$eq with object values', async () => {
      await attempt({ 'data.date': { year: 2013, month: 9, day: 25 } });
    });

    it('$eq with objects in a given position in an array with dot notation', async () => {
      await attempt({ 'data.grades.0.grade': 92 });
    });

    it('$eq with nested elements in array', async () => {
      await attempt({ 'data.projects.Python': 'Flaskapp' });
    });

    it('$matches', async () => {
      await attempt({ 'data.lastName': { $matches: 'a.+e' } });
    });

    it('$not with direct values', async () => {
      await attempt({ 'data.username': { $not: 'mufasa' } });
    });

    it('$not with sub queries', async () => {
      await attempt({ 'data.username': { $not: { $ne: 'kofrasa' } } });
    });

    it('$gt', async () => {
      await attempt({ 'data.jobs': { $gt: 1 } });
    });

    it('$gte', async () => {
      await attempt({ 'data.jobs': { $gte: 6 } });
    });

    it('$lt', async () => {
      await attempt({ 'data.jobs': { $lt: 10 } });
    });

    it('$lte', async () => {
      await attempt({ 'data.jobs': { $lte: 6 } });
    });

    it('$exists (false)', async () => {
      await attempt({ 'data.middlename': { $exists: false } });
    });

    it('$exists (true)', async () => {
      await attempt({ id: { $exists: true } });
    });

    it('can compare value inside array at a given index', async () => {
      await attempt({ 'data.projects.C.1': 'student_record' });
    });

    it('$in', async () => {
      await attempt({ 'data.circles.school': { $in: ['Henry'] } });
    });

    it('$in (false)', async () => {
      await attempt({ 'data.middlename': { $in: [null, 'David'] } });
    });

    it('$nin (false)', async () => {
      await attempt({ 'data.circles.family': { $nin: ['Pamela'] } });
    });

    it('$nin', async () => {
      await attempt({ 'data.firstName': { $nin: [null] } });
    });

    it('$size', async () => {
      await attempt({ 'data.languages.programming': { $size: 7 } });
    });

    it('can find modulo of values with $mod', async () => {
      await attempt({ 'data.date.month': { $mod: [8, 1] } });
    });

    it('$all', async () => {
      await attempt({
        'data.languages.spoken': { $all: ['french', 'english'] },
      });
    });

    it('can match fields for all objects within an array with dot notation', async () => {
      await attempt({ 'data.grades.mean': { $gt: 70 } });
    });
  });

  describe('Query Logical Operators', function () {
    beforeEach(async () => {
      await queue.add('search', Person);
    });

    describe('$and', () => {
      it('can use conjunction true AND true', async () => {
        await attempt({
          $and: [{ 'data.firstName': 'Francis' }, { name: 'search' }],
        });
      });

      it('can use conjunction true AND false', async () => {
        await attempt(
          {
            $and: [
              { 'data.firstName': 'Francis' },
              { 'data.lastName': 'Amoah' },
            ],
          },
          false,
        );
      });

      it('can use conjunction false AND true', async () => {
        await attempt(
          {
            $and: [
              { 'data.firstName': 'Enoch' },
              { 'data.lastName': 'Asante' },
            ],
          },
          false,
        );
      });

      it('can use conjunction false AND false', async () => {
        await attempt(
          {
            $and: [
              { 'data.firstName': 'Enoch' },
              { 'data.age': { $exists: true } },
            ],
          },
          false,
        );
      });
    });

    describe('$or', () => {
      it('can use conjunction true OR true', async () => {
        await attempt({
          $or: [
            { 'data.firstName': 'Francis' },
            { 'data.lastName': { $matches: '^%a.+e' } },
          ],
        });
      });

      it('can use conjunction true OR false', async () => {
        await attempt({
          $or: [{ 'data.firstName': 'Francis' }, { 'data.lastName': 'Amoah' }],
        });
      });

      it('can use conjunction false OR true', async () => {
        await attempt({
          $or: [{ 'data.firstName': 'Enoch' }, { 'data.lastName': 'Asante' }],
        });
      });

      it('can use conjunction false OR false', async () => {
        await attempt(
          {
            $or: [
              { 'data.firstName': 'Enoch' },
              { 'data.age': { $exists: true } },
            ],
          },
          false,
        );
      });
    });

    describe('$nor', () => {
      it('can use conjunction true NOR true', async () => {
        await attempt(
          {
            $nor: [
              { 'data.firstName': 'Francis' },
              { 'data.lastName': { $matches: '^a.+e$' } },
            ],
          },
          false,
        );
      });

      it('can use conjunction true NOR false', async () => {
        await attempt(
          {
            $nor: [
              { 'data.firstName': 'Francis' },
              { 'data.lastName': 'Amoah' },
            ],
          },
          false,
        );
      });

      it('can use conjunction false NOR true', async () => {
        await attempt(
          {
            $nor: [
              { 'data.firstName': 'Enoch' },
              { 'data.lastName': 'Asante' },
            ],
          },
          false,
        );
      });

      it('can use conjunction false NOR false', async () => {
        await attempt({
          $nor: [
            { 'data.firstName': 'Enoch' },
            { 'data.age': { $exists: true } },
          ],
        });
      });
    });

    describe('$isNumber', () => {
      it('correctly identifies integers', async () => {
        await attempt({ 'data.jobs': { $isNumber: true } });
        await attempt({ 'data.date.year': { $isNumber: true } });
      });

      it('correctly identifies floats', async () => {
        await attempt({ 'data.height': { $isNumber: true } });
      });

      it('correctly identifies non numbers', async () => {
        await attempt({ 'data.firstName': { $isNumber: false } });
        await attempt({ 'data.retirement': { $isNumber: false } });
        await attempt({ 'data.grades': { $isNumber: false } });
      });
    });
  });

  describe('Query array operators', function () {
    describe('selector tests', () => {
      const data = [
        {
          key0: [
            {
              key1: [
                [
                  [
                    {
                      key2: [{ a: 'value2' }, { a: 'dummy' }, { b: 20 }],
                    },
                  ],
                ],
                { key2: 'value' },
              ],
              key1a: { key2a: 'value2a' },
            },
          ],
        },
      ];

      async function attempt(
        query: Record<string, any>,
        expected: any[],
      ): Promise<void> {
        const result = await find(data, query);
        expect(result).to.be.eql(expected);
      }

      // eslint-disable-next-line mocha/no-exclusive-tests
      it('should not match without array index selector to nested value ', async () => {
        await attempt({ 'data.key0.key1.key2.a': 'value2' }, []);
      });

      it('should not match without enough depth for array index selector to nested value', async () => {
        await attempt({ 'data.key0.key1.0.key2.a': 'value2' }, []);
      });

      it('should match with full array index selector to deeply nested value', async () => {
        await attempt({ 'data.key0.key1.0.0.key2.a': 'value2' }, data);
      });

      it('should match with array index selector to nested value at depth 1', async () => {
        await attempt({ 'data.key0.key1.0.0.key2': { b: 20 } }, data);
      });

      it('should match with full array index selector to nested value', async () => {
        await attempt({ 'data.key0.key1.1.key2': 'value' }, data);
      });

      it('should match without array index selector to nested value at depth 1', async () => {
        await attempt({ 'data.key0.key1.key2': 'value' }, data);
      });

      it('should match shallow nested value with array index selector', async () => {
        await attempt({ 'data.key0.key1.1.key2': 'value' }, data);
      });
    });

    it('should match nested array of objects without indices', async () => {
      // https://github.com/kofrasa/mingo/issues/51
      const data = [{ key0: [{ key1: ['value'] }, { key1: ['value1'] }] }];
      const result = await findFirst(data, {
        'data.key0.key1': { $eq: 'value' },
      });
      expect(result).to.equal(data[0]);
    });
  });

  describe('Expression Logical Operators', () => {
    const inventory = [
      { _id: 1, sku: 'abc1', description: 'product 1', qty: 300 },
      { _id: 2, sku: 'abc2', description: 'product 2', qty: 200 },
      { _id: 3, sku: 'xyz1', description: 'product 3', qty: 250 },
      { _id: 4, sku: 'VWZ1', description: 'product 4', qty: 300 },
      { _id: 5, sku: 'VWZ2', description: 'product 5', qty: 180 },
    ];

    it('$and', async () => {
      const condition = {
        $and: [{ $gt: ['$data.qty', 100] }, { $lt: ['$data.qty', 250] }],
      };
      await checkExpressionByList(
        inventory,
        condition,
        data => data.qty > 100 && data.qty < 250,
        '_id',
      );
    });

    it('$or', async () => {
      const condition = {
        $or: [{ $gt: ['$data.qty', 250] }, { $lt: ['$data.qty', 200] }],
      };
      await checkExpressionByList(
        inventory,
        condition,
        data => data.qty > 250 || data.qty < 200,
        '_id',
      );
    });

    it('$not', async () => {
      const condition = { $not: { $gt: ['$data.qty', 250] } };
      await checkExpressionByList(
        inventory,
        condition,
        data => !(data.qty > 250),
        '_id',
      );
    });

    it('$in', async () => {
      const condition = { $in: ['$data.sku', ['abc1', 'abc2']] };
      await checkExpressionByList(
        inventory,
        condition,
        data => ['abc1', 'abc2'].includes(data.sku),
        '_id',
      );
    });

    it('$nin', async () => {
      const condition = { $nin: ['$data.sku', ['abc1', 'abc2']] };
      await checkExpressionByList(
        inventory,
        condition,
        data => !['abc1', 'abc2'].includes(data.sku),
        '_id',
      );
    });
  });

  describe('Conditional Operators', () => {
    const data: Record<string, any> = {
      lowScore: 100,
      highScore: 200,
      score: 150,
      nullValue: null,
    };

    beforeEach(async () => {
      await queue.add('search', data);
    });

    async function check(
      criteria: Record<string, unknown>,
      expectMatch = true,
    ): Promise<void> {
      const { jobs } = await queue.getJobsByFilter('waiting', criteria, 0);
      expect(!!jobs.length).to.equal(expectMatch);
    }

    describe('$cond', () => {
      it('supports options as an object', async () => {
        const conditional = {
          $cond: {
            if: { $lte: ['$data.lowScore', '$data.highScore'] },
            then: 'low',
            else: 'high',
          },
        };
        await checkExpression(conditional, 'low');
      });

      it('supports options as an an array', async () => {
        const conditional = {
          $cond: [
            { $gte: ['$data.highScore', '$data.lowScore'] },
            'high',
            'low',
          ],
        };
        await checkExpression(conditional, 'high');
      });
    });

    describe('$ifNull', () => {
      it('uses default value if null is found', async () => {
        const conditional = { $ifNull: [null, 'default'] };
        await checkExpression(conditional, 'default');
      });

      it('uses non null value', async () => {
        const conditional = { $ifNull: [5, 'default'] };
        const criteria = { $expr: { $eq: [5, conditional] } };
        await checkExpression(conditional, 5);
      });

      it('errors on invalid args', async () => {
        const conditional = { $ifNull: [5, 'default', 'error'] };
        const criteria = { $expr: { $eq: [5, conditional] } };
        expect(() => check(criteria, false)).to.throw(
          /\$ifNull expression must resolve to array(2)/,
        );
      });
    });

    describe('$switch', () => {
      type Case = [expression: Record<string, any>, expected: string];
      const cases: Case[] = [
        [
          {
            $switch: {
              branches: [
                { case: { $lte: ['$data.lowScore', 10] }, then: 'low' },
                { case: { $gte: ['$data.highScore', 200] }, then: 'high' },
              ],
              default: 'normal',
            },
          },
          'high',
        ],
        [
          {
            $switch: {
              branches: [
                {
                  case: { $lte: ['$data.lowScore', '$data.highScore'] },
                  then: 'low',
                },
                { case: { $gte: ['$data.highScore', 5000] }, then: 'high' },
              ],
              default: 'normal',
            },
          },
          'low',
        ],
        [
          {
            $switch: {
              branches: [
                { case: { $lt: ['$data.lowScore', 10] }, then: 'low' },
                {
                  case: { $gt: ['$data.score', '$data.highScore'] },
                  then: 'high',
                },
              ],
              default: 'normal',
            },
          },
          'normal',
        ],
      ];

      for (const [expression, expected] of cases) {
        it(`${JSON.stringify(expression)} => ${expected}`, async () => {
          await checkExpression(expression, expected);
        });
      }
    });
  });

  describe('Arithmetic Operators', () => {
    describe('$add', () => {
      const cases = [
        [[10, 2], 12],
        [[-1, 5], 4],
        [[-3, -7], -10],
      ];
      testExpressionCases('$add', cases);
    });

    describe('$abs', () => {
      const cases = [
        [null, null],
        [-1, 1],
        [1, 1],
      ];
      testExpressionCases('$abs', cases);
    });

    describe('$subtract', () => {
      const cases = [
        [[-1, -1], 0],
        [[-1, 2], -3],
        [[2, -1], 3],
      ];
      testExpressionCases('$subtract', cases);
    });

    describe('$multiply', () => {
      const cases = [
        [[5, 10], 50],
        [[-2, 4], -8],
        [[-3, -3], 9],
      ];
      testExpressionCases('$multiply', cases);
    });

    describe('$divide', () => {
      const cases = [
        [[80, 4], 20],
        [[1.5, 3], 0.5],
        [[40, 8], 5],
      ];
      testExpressionCases('$divide', cases);
    });

    describe('$round', () => {
      const cases = [
        [[10.5, 0], 10],
        [[11.5, 0], 12],
        [[12.5, 0], 12],
        [[13.5, 0], 14],
        // rounded to the first decimal place
        [[19.25, 1], 19.2],
        [[28.73, 1], 28.7],
        [[34.32, 1], 34.3],
        [[-45.39, 1], -45.4],
        // rounded using the first digit to the left of the decimal
        [[19.25, -1], 10],
        [[28.73, -1], 20],
        [[34.32, -1], 30],
        [[-45.39, -1], -50],
        // rounded to the whole integer
        [[19.25, 0], 19],
        [[28.73, 0], 28],
        [[34.32, 0], 34],
        [[-45.39, 0], -45],
      ];
      testExpressionCases('$round', cases);
    });

    describe('$trunc', () => {
      const cases = [
        [[null, 0], null],
        [[0, 0], 0],
        // truncate to the first decimal place
        [[19.25, 1], 19.2],
        [[28.73, 1], 28.7],
        [[34.32, 1], 34.3],
        [[-45.39, 1], -45.3],
        // truncated to the first place
        [[19.25, -1], 10],
        [[28.73, -1], 20],
        [[34.32, -1], 30],
        [[-45.39, -1], -40],
        // truncate to the whole integer
        [[19.25, 0], 19],
        [[28.73, 0], 28],
        [[34.32, 0], 34],
        [[-45.39, 0], -45],
      ];
      testExpressionCases('$trunc', cases);
    });

    describe('$mod', () => {
      const cases = [
        [[80, 7], 3],
        [[40, 4], 0],
      ];
      testExpressionCases('$mod', cases);
    });

    describe('$ceil', () => {
      const cases = [
        [null, null],
        [1, 1],
        [7.8, 8],
        [-2.8, -2],
      ];
      testExpressionCases('$ceil', cases);
    });

    describe('$floor', () => {
      const cases = [
        [null, null],
        [1, 1],
        [7.8, 7],
        [-2.8, -3],
      ];
      testExpressionCases('$floor', cases);
    });

    describe('$sqrt', () => {
      const cases = [
        [null, null],
        [NaN, NaN],
        [25, 5],
        [30, 5.477225575051661],
      ];
      testExpressionCases('$sqrt', cases);
    });

    describe('$max', () => {
      const cases = [
        [1, 1],
        [[null], null],
        [[1.5, 3], 3],
        [[-1, null, '13', 4], 4],
        [[0, 0.005], 0.005],
        [[-67, 1], 1],
        [[0, 1, 19, -45], 19],
      ];
      testExpressionCases('$max', cases);
    });

    describe('$min', () => {
      const cases = [
        [4, 4],
        [[null], null],
        [[1.5, 3], 1.5],
        [[-1, null, '-13', 4], -1],
        [[0, 0.005], 0],
        [[-20, 71], -20],
        [[0, 1, 3, 19, -45], -45],
      ];
      testExpressionCases('$min', cases);
    });
  });

  describe('String Operators', () => {
    describe('$toLower', () => {
      const cases = [
        [null, null],
        ['hEl1O', 'hel1o'],
      ];
      testExpressionCases('$toLower', cases);
    });

    describe('$toUpper', () => {
      const cases = [
        [null, null],
        ['This is lOwer', 'THIS IS LOWER'],
      ];
      testExpressionCases('$toUpper', cases);
    });

    describe('$contains', () => {
      const cases = [
        [[null, null], false],
        [['hyperactive', 'hyper'], true],
        [['milliseconds', 'not-prefix'], false],
      ];
      testExpressionCases('$contains', cases);
    });

    describe('$startsWith', () => {
      const cases = [
        [[null, null], false],
        [['hyperactive', 'hyper'], true],
        [['milliseconds', 'not-prefix'], false],
      ];
      testExpressionCases('$startsWith', cases);
    });

    describe('$endsWith', () => {
      const cases = [
        [[null, null], false],
        [['hyperactive', 'active'], true],
        [['milliseconds', 'minutes'], false],
      ];
      testExpressionCases('$endsWith', cases);
    });

    describe('$strcasecmp', () => {
      const cases = [
        [[null, null], 0],
        [['13Q1', '13q4'], -1],
        [['13Q4', '13q4'], 0],
        [['14Q2', '13q4'], 1],
      ];
      testExpressionCases('$strcasecmp', cases);
    });

    describe('$strLenBytes', () => {
      const cases = [
        ['abcde', 5],
        ['Hello World!', 12],
        ['cafeteria', 9],
        ['', 0],
        // ["cafétéria", 9],
        // ["$€λG", 4],
        // ["寿司" , 2]
      ];
      testExpressionCases('$strLenBytes', cases);
    });

    describe('$substr', () => {
      const cases = [
        [[null, 2], null],
        [['hello', -1], ''],
        [['hello', 1, -2], 'ello'],
        [['abcde', 1, 2], 'bc'],
        [['Hello World!', 6, 5], 'World'],
        [['cafeteria', 0, 5], 'cafet'],
        [['cafeteria', 5, 4], 'eria'],
        [['cafeteria', 7, 3], 'ia'],
        [['cafeteria', 3, 1], 'e'],
      ];
      testExpressionCases('$substr', cases);
    });

    describe('$substr/$substrBytes', () => {
      const cases = [
        [[null, 2], null],
        [['hello', -1], ''],
        [['hello', 1, -2], 'ello'],
        [['abcde', 1, 2], 'bc'],
        [['Hello World!', 6, 5], 'World'],
        [['cafeteria', 0, 5], 'cafet'],
        [['cafeteria', 5, 4], 'eria'],
        [['cafeteria', 7, 3], 'ia'],
        [['cafeteria', 3, 1], 'e'],
      ];
      testExpressionCases('$substr', cases);
      testExpressionCases('$substrBytes', cases);
    });

    describe('$concat', () => {
      const cases = [
        [[null, 'abc'], null],
        [['a', '-', 'c'], 'a-c'],
      ];
      testExpressionCases('$concat', cases);
    });

    describe('$split', () => {
      const cases = [
        [[null, '/'], null],
        [
          ['June-15-2013', '-'],
          ['June', '15', '2013'],
        ],
        [
          ['banana split', 'a'],
          ['b', 'n', 'n', ' split'],
        ],
        [
          ['Hello World', ' '],
          ['Hello', 'World'],
        ],
        [
          ['astronomical', 'astro'],
          ['', 'nomical'],
        ],
        [['pea green boat', 'owl'], ['pea green boat']],
      ];
      testExpressionCases('$split', cases);
    });

    function testTrim(operator: string, cases: string[][]) {
      // todo: convert back to test.each when wee move to jest/vitest
      for (const [input, chars, expected] of cases) {
        const data = {
          value: input,
        };
        const expression = {
          [operator]: { input: '$data.value', ...(chars && { chars }) },
        };
        it(`${operator}: ${input}`, async () => {
          await queue.add('search', data);
          await checkExpression(expression, expected);
        });
      }
    }

    describe('$trim', () => {
      const cases = [
        ['  \n good  bye \t  ', null, 'good  bye'],
        [' ggggoodbyeeeee', 'ge', ' ggggoodby'],
        ['    ggggoodbyeeeee', ' ge', 'oodby'],
        [null, null, null],
      ];
      testTrim('$trim', cases);
    });

    describe('$ltrim', () => {
      const cases = [
        ['  \n good  bye \t  ', null, 'good  bye \t  '],
        [' ggggoodbyeeeee', 'ge', ' ggggoodbyeeeee'],
        ['    ggggoodbyeeeee ', ' gd', 'oodbyeeeee '],
        [null, null, null],
      ];
      testTrim('$ltrim', cases);
    });

    describe('$rtrim', () => {
      const cases = [
        ['  \n good  bye \t  ', null, '  \n good  bye'],
        [' ggggoodbyeeeee', 'ge', ' ggggoodby'],
        [' ggggoodbyeeeee    ', 'e ', ' ggggoodby'],
        [null, null, null],
      ];
      testTrim('$rtrim', cases);
    });
  });

  describe('Type Operators', () => {
    describe('$type', () => {
      beforeEach(async () => {
        await queue.add('search', Person);
      });

      it('can handle "object"', async () => {
        await attempt({ data: { $type: 'object' } });
      });

      it('can handle "number"', async () => {
        await attempt({ 'data.jobs': { $type: 'number' } });
      });

      it('can handle "array"', async () => {
        await attempt({ 'data.grades': { $type: 'array' } });
      });

      it('can handle "boolean"', async () => {
        await attempt({ 'data.isActive': { $type: 'boolean' } });
      });

      it('can handle "string"', async () => {
        await attempt({ name: { $type: 'string' } });
      });

      it('can handle "null"', async () => {
        await attempt({ 'data.retirement': { $type: 'null' } });
      });

      it('can match multiple types with $type using an array', async () => {
        await attempt({ timestamp: { $type: ['number', 'string'] } });
      });
    });

    describe('$toString', () => {
      const cases = [
        [true, 'true'],
        [false, 'false'],
        [2.5, '2.5'],
        [12345, '12345'],
      ];
      testExpressionCases('$toString', cases);
    });

    describe('$toBool', () => {
      const cases = [
        [true, true],
        [0, false],
        [1, true],
        ['true', true],
        ['false', true], // Note: All strings convert to true
        ['', true], // Note: All strings convert to true
      ];
      testExpressionCases('$toBool', cases);
    });

    describe('$toBoolEx', () => {
      const cases = [
        [true, true],
        [0, false],
        [1, true],
        [0.25, true],
        [-1, true],
        ['true', true],
        ['false', false],
        ['476', true],
        ['gibberish', true],
        ['', false],
      ];
      testExpressionCases('$toBoolEx', cases);
    });

    describe('$toLong/$toInt', () => {
      const cases = [
        [5, 5],
        ['100', 100],
        [500, 500],
        ['-487', -487],
      ];
      testExpressionCases('$toLong', cases);
    });

    describe('$toDecimal', () => {
      it('converts values to decimal', async () => {
        const data = [
          { _id: 1, item: 'apple', qty: 5, price: '10.0', total: 50 },
          { _id: 2, item: 'pie', qty: 10, price: 20.0, total: 200.0 },
          { _id: 3, item: 'ice cream', qty: 2, price: '4.99', total: 9.98 },
          { _id: 4, item: 'almonds', qty: 4, price: '5.25', total: 21 },
        ];
        const expr = {
          $eq: [
            { $multiply: ['$data.qty', { $toDecimal: '$data.price' }] },
            '$data.total',
          ],
        };
        await checkExpressionByList(data, expr, () => true, '_id');
      });
    });
  });

  describe('Miscellaneous Expression Operators', () => {
    describe('$cmp', () => {
      it('properly compares values', async () => {
        const data = [
          { item: 'abc1', qty: 300, expected: 1 },
          { item: 'abc2', qty: 200, expected: -1 },
          { item: 'xyz1', qty: 250, expected: 0 },
          { item: 'VWZ1', qty: 300, expected: 1 },
          { item: 'VWZ2', qty: 180, expected: -1 },
        ];
        const expr = { $eq: [{ $cmp: ['$data.qty', 250] }, '$data.expected'] };

        await checkExpressionByList(data, expr, () => true, 'item');
      });
    });

    describe('$literal', () => {
      const stock = [
        { _id: 1, item: 'abc123', price: '$2.50' },
        { _id: 2, item: 'xyz123', price: '1' },
        { _id: 3, item: 'ijk123', price: '$1' },
      ];

      it('can use $literal in expressions', async () => {
        const expr = { $eq: ['$data.price', { $literal: '$1' }] };
        await checkExpressionByList(
          stock,
          expr,
          item => item.price == '$1',
          '_id',
        );
      });
    });
  });

  describe('$matches', () => {
    it('can match against non-array property', async () => {
      const res = await find([{ l1: [{ tags: 'tag1' }, { notags: 'yep' }] }], {
        'data.l1.tags': { $matches: '.*tag.*' },
      });
      expect(res.length).to.equal(1);
    });

    it('can match against array property', async () => {
      const data = [
        {
          l1: [{ tags: ['tag1', 'tag2'] }, { tags: ['tag66'] }],
        },
      ];
      const res = await find(data, {
        'data.l1.tags': {
          $matches: '^tag*',
        },
      });
      expect(res.length).to.equal(1);
    });
  });

  describe('$expr tests', function () {
    // https://docs.mongodb.com/manual/reference/operator/query/expr/

    it('compare two fields from a single document', async () => {
      const data = [
        { _id: 1, category: 'food', budget: 400, spent: 450 },
        { _id: 2, category: 'drinks', budget: 100, spent: 150 },
        { _id: 3, category: 'clothes', budget: 100, spent: 50 },
        { _id: 4, category: 'misc', budget: 500, spent: 300 },
        { _id: 5, category: 'travel', budget: 200, spent: 650 },
      ];

      const expr = { $gt: ['$data.spent', '$data.budget'] };

      await checkExpressionByList(
        data,
        expr,
        data => data.spent > data.budget,
        '_id',
      );
    });

    it('using $expr with conditional statements', async () => {
      const data = [
        { _id: 1, item: 'binder', qty: 100, price: 12 },
        { _id: 2, item: 'notebook', qty: 200, price: 8 },
        { _id: 3, item: 'pencil', qty: 50, price: 6 },
        { _id: 4, item: 'eraser', qty: 150, price: 3 },
      ];

      function calcValue(data: { qty: any; price: any }) {
        const { qty, price } = data;
        return price / (qty >= 100 ? 2 : 4);
      }

      const expr = {
        $lt: [
          {
            $cond: {
              if: { $gte: ['$data.qty', 100] },
              then: { $divide: ['$data.price', 2] },
              else: { $divide: ['$data.price', 4] },
            },
          },
          5,
        ],
      };

      await checkExpressionByList(
        data,
        expr,
        data => calcValue(data) < 5,
        '_id',
      );
    });
  });

  describe('null or missing fields', () => {
    const data = [{ _id: 1, item: null }, { _id: 2 }];

    async function attempt(
      criteria: Record<string, any>,
      expected: { _id: number; item?: any }[],
    ) {
      const res = await find(data, criteria);
      expect(res).to.eql(expected);
    }

    it('should return all documents', async () => {
      const expected = [{ _id: 1, item: null }, { _id: 2 }];
      await attempt({ 'data.item': null }, expected);
    });

    it('should return one document with null field', async () => {
      const query = { 'data.item': { $type: 'null' } };
      const expected = [{ _id: 1, item: null }];
      await attempt(query, expected);
    });

    it('should return one document without null field', async () => {
      const query = { 'data.item': { $exists: false } };
      const expected = [{ _id: 2 }];
      await attempt(query, expected);
    });

    it('$in should return all documents', async function () {
      const query = { 'data.item': { $in: [null, false] } };
      const expected = [{ _id: 1, item: null }, { _id: 2 }];
      await attempt(query, expected);
    });
  });
});
