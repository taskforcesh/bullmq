import { expect } from 'chai';
import { beforeEach, describe, it, before, after as afterAll } from 'mocha';
import { v4 } from 'uuid';
import { Job, JobJsonRaw, Queue, ServerQuery } from '../src';
import { removeAllQueueData } from '../src';
import * as sinon from 'sinon';
import { default as IORedis } from 'ioredis/built/Redis';

const Person: Record<string, any> = {
  _id: '100',
  firstName: 'Francis',
  lastName: 'Asante',
  username: 'kofrasa',
  title: 'Software Engineer',
  degree: 'Computer Science',
  jobs: 6,
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

// eslint-disable-next-line mocha/no-exclusive-tests
describe.only('getJobsByFilter', () => {
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';
  const sandbox = sinon.createSandbox();

  let queue: Queue;
  let queueName: string;

  let connection: IORedis;
  before(async function () {
    connection = new IORedis(redisHost, { maxRetriesPerRequest: null });
  });

  beforeEach(async function () {
    queueName = `test-${v4()}`;
    queue = new Queue(queueName, { connection, prefix });
    await queue.waitUntilReady();
  });

  afterEach(async function () {
    sandbox.restore();
    await queue.close();
    await removeAllQueueData(new IORedis(redisHost), queueName);
  });

  afterAll(async function () {
    await connection.quit();
  });

  async function updateJob(job: Job, update: Partial<JobJsonRaw>) {
    const client = await queue.client;
    const jobId = job.id;
    const redisKey = queue.toKey(jobId);
    await client.hset(redisKey, update);
  }

  async function find(
    arr: Record<string, any>[],
    criteria: Record<string, any>,
    cursorId?: string,
  ): Promise<Record<string, any>[]> {
    const bulkData = arr.map(item => {
      return { name: 'default', data: item };
    });
    await queue.addBulk(bulkData);
    const { jobs } = await queue.getJobsByFilter(
      'waiting',
      criteria,
      100,
      true,
      cursorId,
    );
    return jobs.map(job => job.data);
  }

  async function checkExpressionByList(
    data: Record<string, any>[],
    query: Record<string, any>,
    filterFn: (arg0: any) => boolean = () => true,
    sortBy: string = null,
  ): Promise<void> {
    // were checking expression operators, so transform the query
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
    criteria: ServerQuery,
    expectMatch = true,
  ): Promise<void> {
    const { jobs } = await queue.getJobsByFilter('waiting', criteria);
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

  function testExpressionCases(operator: string, cases: any[]) {
    for (const [args, expected] of cases) {
      it(`Operator ${operator} `, async () => {
        const data: Record<string, any> = {};
        const condition: ServerQuery = {};
        if (Array.isArray(args) && args.length == 2) {
          data['first'] = args[0];
          data['second'] = args[1];
          condition[operator] = ['$data.first', '$data.second'];
        } else {
          data['value'] = args;
          condition[operator] = '$data.value';
        }

        await queue.add('default', data);
        await checkExpression(condition, expected);
      });
    }
  }

  describe('Basic field access', () => {
    let job;

    beforeEach(async () => {
      job = await queue.add('default', Person);
    });

    it('can access basic job fields', async () => {
      const fields = [
        'id',
        'data',
        'delay',
        'timestamp',
        'priority',
        'attemptsStarted',
        'attemptsMade',
        'stalledCounter',
        'failedReason',
        'progress',
        'returnvalue',
        'opts',
      ];
      await attempt({ id: { $exists: true } });
      await attempt({ name: { $exists: true } });
      await attempt({ timestamp: { $exists: true } });
      await attempt({ data: { $exists: true } });
      await attempt({ opts: { $exists: true } });
    });
  });

  describe('Comparison, Evaluation, and Element Operators', () => {
    let job: Job;

    beforeEach(async () => {
      job = await queue.add('default', Person);
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
    let job: Job;

    beforeEach(async () => {
      job = await queue.add('default', Person);
    });

    describe('$and', () => {
      it('can use conjunction true AND true', async () => {
        await attempt({
          $and: [{ 'data.firstName': 'Francis' }, { name: 'default' }],
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
        query: ServerQuery,
        expected: Record<string, any>[],
      ): Promise<void> {
        const result = await find(data, query);
        expect(result).to.eql(expected);
      }

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
      expect(result).to.eql(data[0]);
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
    let job: Job;

    const data: Record<string, any> = {
      lowScore: 100,
      highScore: 200,
      score: 150,
      nullValue: null,
    };

    beforeEach(async () => {
      job = await queue.add('default', data);
    });

    async function check(
      criteria: ServerQuery,
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
        expect(() => check(criteria, false)).throws(
          /\$ifNull expression must resolve to array(2)/,
        );
      });
    });
  });

  describe('String Operators', () => {
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
  });

  describe('Type Operators', () => {
    describe('$type', () => {
      let job: Job;

      beforeEach(async () => {
        job = await queue.add('default', Person);
      });

      it('correctly identifies numeric types for metadata fields', async () => {
        const number_fields: string[] = [
          'progress',
          'delay',
          'priority',
          'timestamp',
          'attemptsMade',
          'attemptsStarted',
          'stalledCounter',
        ];
        for (const field of number_fields) {
          await attempt({ [field]: { $type: 'number' } });
        }
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
        [0.25, true],
        [-1, true],
        ['true', true],
        ['false', false],
        ['476', true],
        ['gibberish', true],
        ['', false],
      ];
      testExpressionCases('$toBool', cases);
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
        { _id: 1, item: 'binder', qty: 100, price: 12, discountPrice: 10 },
        { _id: 2, item: 'notebook', qty: 200, price: 8, discountPrice: 6 },
        { _id: 3, item: 'pencil', qty: 50, price: 6, discountPrice: 5 },
        { _id: 4, item: 'eraser', qty: 150, price: 3, discountPrice: 2 },
      ];

      const expr = {
        $cond: {
          if: { $gte: ['$data.qty', 100] },
          then: { $literal: true },
          else: { $literal: false },
        },
      };

      await checkExpressionByList(data, expr, data => data.qty >= 100, '_id');
    });
  });

  describe('null or missing fields', () => {
    const data: Record<string, any>[] = [{ _id: 1, item: null }, { _id: 2 }];

    async function attempt(
      criteria: ServerQuery,
      expected: Record<string, any>,
    ) {
      const res = await find(data, criteria);
      expect(res).to.be.eql(expected);
    }

    it('should return all documents', async () => {
      const expected: Record<string, any> = [
        { _id: 1, item: null },
        { _id: 2 },
      ];
      await attempt({ 'data.item': null }, expected);
    });

    it('should return one document with null field', async () => {
      const query = { 'data.item': { $type: 'null' } };
      const expected: Record<string, any>[] = [{ _id: 1, item: null }];
      await attempt(query, expected);
    });

    it('should return one document without null field', async () => {
      const query = { 'data.item': { $exists: false } };
      const expected = [{ _id: 2 }];
      await attempt(query, expected);
    });

    it('$in should return all documents', async function () {
      const query = { 'data.item': { $in: [null, false] } };
      const expected: Record<string, any>[] = [
        { _id: 1, item: null },
        { _id: 2 },
      ];
      await attempt(query, expected);
    });
  });

  describe('Search Text', () => {
    describe('When performing a non-field Search', () => {
      it('should search the name field', async () => {
        const data = [
          { name: 'translate-en', data: { _id: 1 } },
          { name: 'translate-fr', data: { _id: 2 } },
          { name: 'default', data: { _id: 3 } },
          { name: 'inference', data: { _id: 4 } },
          { name: 'default', data: { _id: 5 } },
        ];

        await queue.addBulk(data);

        const { jobs } = await queue.getJobsByFilter('wait', 'translate');
        expect(jobs.length).to.equal(2);

        const { jobs: jobs1 } = await queue.getJobsByFilter(
          'wait',
          'inference',
        );
        expect(jobs1.length).to.equal(1);
        const jobData = jobs1[0].data;
        expect(jobData).to.be.eql({ _id: 4 });
      });

      it('should search job data', async () => {
        const personCopy = structuredClone(Person);
        personCopy.title = 'Scrum Master';
        personCopy.firstName = 'Johnny';

        await queue.addBulk([
          { name: 'hire-candidate', data: Person },
          { name: 'hire-candidate', data: personCopy },
        ]);

        const query = 'Scrum';

        const { jobs } = await queue.getJobsByFilter('wait', query);
        expect(jobs.length).to.equal(1);
        const job = jobs[0];
        expect(job.data.title).to.equal('Scrum Master');
      });

      it('should search in logs', async () => {
        const data = [
          { name: 'default', data: { _id: 1 } },
          { name: 'default', data: { _id: 2 } },
          { name: 'default', data: { _id: 3 } },
          { name: 'default', data: { _id: 4 } },
          { name: 'default', data: { _id: 5 } },
        ];

        const searchTerm = 'indubitably';

        let expectedCount = 0;
        const jobs = await queue.addBulk(data);
        const i = 0;
        for (const job of jobs) {
          if (i % 2 == 0) {
            expectedCount++;
            await job.log(searchTerm);
          }
        }

        const { jobs: foundJobs } = await queue.getJobsByFilter(
          'wait',
          searchTerm,
        );
        expect(foundJobs.length).to.equal(expectedCount);
      });

      it('should search the stacktrace', async () => {
        const data = [
          { name: 'alpha', data: { _id: 1 } },
          { name: 'beta', data: { _id: 2 } },
          { name: 'gamma', data: { _id: 3 } },
          { name: 'delta', data: { _id: 4 } },
        ];

        const addedJobs = await queue.addBulk(data);
        const stacktrace = JSON.stringify(['an error occurred']);
        await updateJob(addedJobs[2], { stacktrace });
        const { jobs } = await queue.getJobsByFilter('wait', 'occurred');

        expect(jobs.length).to.equal(1);
        const job = jobs[0];
        expect(job.name).to.equal('gamma');
      });

      it('should search the failedReason', async () => {
        const data = [
          { name: 'first', data: { _id: 1 } },
          { name: 'second', data: { _id: 2 } },
        ];

        const addedJobs = await queue.addBulk(data);
        const failedReason = 'server timeout';
        await updateJob(addedJobs[0], { failedReason });
        const { jobs } = await queue.getJobsByFilter('wait', 'timeout');

        expect(jobs.length).to.equal(1);
        const job = jobs[0];
        expect(job.name).to.equal('first');
      });

      it('should search on returnvalue', async () => {
        const data = [
          { name: 'first', data: { _id: 1 } },
          { name: 'second', data: { _id: 2 } },
        ];
        const added = await queue.addBulk(data);
        const returnValue = JSON.stringify({ value: 99, status: 'failed' });
        updateJob(added[0], { returnvalue: returnValue });
        const returnValue1 = JSON.stringify({ value: 42, status: 'success' });
        updateJob(added[1], { returnvalue: returnValue1 });

        const { jobs: successful } = await queue.getJobsByFilter(
          'wait',
          'success',
        );
        expect(successful.length).to.equal(1);
        expect(successful[0].name).to.equal('second');

        const { jobs: failed } = await queue.getJobsByFilter('wait', '99');
        expect(failed.length).to.equal(1);
        expect(failed[0].name).to.equal('first');
      });

      it('should perform multi-term search', async () => {
        const data = [
          { name: 'alpha', data: { _id: 1 } },
          { name: 'delta', data: { _id: 2 } },
          { name: 'trois', data: { _id: 3 } },
          { name: 'inference', data: { _id: 4 } },
          { name: 'default', data: { _id: 5 } },
        ];

        const added = await queue.addBulk(data);
        const stacktrace = JSON.stringify(['epsilon']);
        await updateJob(added[4], { stacktrace });
        await added[3].log('gamma');

        const { jobs } = await queue.getJobsByFilter(
          'wait',
          'alpha beta gamma epsilon',
        );
        expect(jobs.length).to.equal(3);
        const names = jobs.map(x => x.name).sort();
        expect(names).to.deep.equal(['alpha', 'default', 'inference']);
      });
    });
    describe('When performing fielded search', async () => {
      describe('Range Queries', () => {
        const inventory = [
          {
            name: 'alice',
            data: { item: 'abc1', price: 10.99, qty: 300, code: 'A123' },
          },
          {
            name: 'bob',
            data: { item: 'abc2', price: 25.99, qty: 200, code: 'B456' },
          },
          {
            name: 'chris',
            data: { item: 'xyz1', price: 35.99, qty: 250, code: 'C789' },
          },
          {
            name: 'david',
            data: { item: 'VWZ1', price: 45.99, qty: 300, code: 'D012' },
          },
          {
            name: 'evan',
            data: { item: 'VWZ2', price: 55.99, qty: 180, code: 'E345' },
          },
        ];

        beforeEach(async () => {
          await queue.addBulk(inventory);
        });

        describe('Numeric Ranges', () => {
          it('should handle closed range [min TO max]', async () => {
            const query = 'data.price:[25.99 TO 45.99]';
            const { jobs } = await queue.getJobsByFilter('waiting', query);
            expect(jobs.length).to.equal(3);
            const prices = jobs.map(j => j.data.price).sort();
            expect(prices).to.eql([25.99, 35.99, 45.99]);
          });

          it('should handle open range {min TO max}', async () => {
            const query = 'data.qty:{180 TO 300}';
            const { jobs } = await queue.getJobsByFilter('waiting', query);
            expect(jobs.length).to.equal(1);
            expect(jobs[0].data.qty).to.equal(250);
          });

          it('should handle left-open, right-closed range {min TO max]', async () => {
            const query = 'data.price:{35.99 TO 55.99]';
            const { jobs } = await queue.getJobsByFilter('waiting', query);
            expect(jobs.length).to.equal(2);
            const prices = jobs.map(j => j.data.price).sort();
            expect(prices).to.eql([45.99, 55.99]);
          });

          it('should handle left-closed, right-open range [min TO max}', async () => {
            const query = 'data.qty:[250 TO 300}';
            const { jobs } = await queue.getJobsByFilter('waiting', query);
            expect(jobs.length).to.equal(1);
            expect(jobs[0].data.qty).to.equal(250);
          });

          it('should handle unbounded ranges with wildcards', async () => {
            const query = 'data.price:[45.99 TO *]';
            const { jobs } = await queue.getJobsByFilter('waiting', query);
            expect(jobs.length).to.equal(2);
            const prices = jobs.map(j => j.data.price).sort();
            expect(prices).to.eql([45.99, 55.99]);
          });
        });

        describe('String Ranges', () => {
          it('should handle closed range for strings [min TO max]', async () => {
            const query = 'name:[bob TO david]';
            const { jobs } = await queue.getJobsByFilter('waiting', query);
            expect(jobs.length).to.equal(3);
            const codes = jobs.map(j => j.data.code).sort();
            expect(codes).to.eql(['bob', 'chris', 'david']);
          });

          it('should handle open range for strings {min TO max}', async () => {
            const query = 'data.item:{abc TO xyz}';
            const { jobs } = await queue.getJobsByFilter('waiting', query);
            expect(jobs.length).to.equal(1);
            expect(jobs[0].data.item).to.equal('VWZ1');
          });

          it('should handle mixed ranges for strings [min TO max}', async () => {
            const query = 'data.code:[B456 TO E345}';
            const { jobs } = await queue.getJobsByFilter('waiting', query);
            expect(jobs.length).to.equal(2);
            const codes = jobs.map(j => j.data.code).sort();
            expect(codes).to.eql(['B456', 'C789']);
          });

          it('should handle unbounded string ranges', async () => {
            const query = 'data.item:[VWZ* TO *]';
            const { jobs } = await queue.getJobsByFilter('waiting', query);
            expect(jobs.length).to.equal(2);
            const items = jobs.map(j => j.data.item).sort();
            expect(items).to.eql(['VWZ1', 'VWZ2']);
          });
        });

        describe('Invalid Ranges', () => {
          it('should handle malformed range queries', async () => {
            const query = 'data.price:[45.99]'; // Missing TO
            const { jobs } = await queue.getJobsByFilter('waiting', query);
            expect(jobs.length).to.equal(0);
          });

          it('should handle invalid range bounds', async () => {
            const query = 'data.price:[abc TO def]'; // Invalid numeric bounds
            const { jobs } = await queue.getJobsByFilter('waiting', query);
            expect(jobs.length).to.equal(0);
          });
        });
      });
    });
  });
});
