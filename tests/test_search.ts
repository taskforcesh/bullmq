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

 
describe('Search', () => {
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
    const redisKey = queue.toKey(job.id);
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
    const { jobs } = await queue.search(
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
    const { jobs } = await queue.search('waiting', criteria);
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

    describe('$regex', () => {
      it('can match using $regex operator', async () => {
        await attempt({ 'data.lastName': { $regex: 'a.+e' } });
      });

      it('can match using $regex with options', async () => {
        await attempt({
          'data.lastName': { $regex: { $pattern: 'A.+E', $options: 'i' } },
        });
      });

      it('can match against non-array property', async () => {
        const res = await find(
          [{ l1: [{ tags: 'tag1' }, { notags: 'yep' }] }],
          {
            'data.l1.tags': { $regex: '.*tag.*' },
          },
        );
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
            $regex: '^tag.*',
          },
        });
        expect(res.length).to.equal(1);
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
            { 'data.lastName': { $regex: '^%a.+e' } },
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

    describe('$xor', () => {
      it('can use conjunction true XOR true', async () => {
        await attempt(
          {
            $xor: [
              { 'data.firstName': 'Francis' },
              { 'data.username': 'kofrasa' },
            ],
          },
          false,
        );
      });

      it('can use conjunction true XOR false', async () => {
        await attempt(
          {
            $xor: [
              { 'data.firstName': 'Francis' },
              { 'data.lastName': 'Amoah' },
            ],
          },
          true,
        );
      });

      it('can use conjunction false XOR true', async () => {
        await attempt(
          {
            $xor: [
              { 'data.firstName': 'Enoch' },
              { 'data.lastName': 'Asante' },
            ],
          },
          true,
        );
      });

      it('can use conjunction false XOR false', async () => {
        await attempt(
          {
            $xor: [
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
              { 'data.lastName': { $regex: '^a.+e$' } },
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
      const { jobs } = await queue.search('waiting', criteria, 0);
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
        await checkExpression(conditional, 5);
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

    describe('$cmp', () => {
      const cases = [
        [[null, null], 0],
        [['13Q1', '13q4'], -1],
        [['13d4', '13d4'], 0],
        [['14Q2', '13q4'], 1],
      ];
      testExpressionCases('$cmp', cases);
    });
  });

  describe('Type Operators', () => {
    describe('$type', () => {
      let job: Job;

      beforeEach(async () => {
        job = await queue.add('default', Person);
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

    describe('$toNumber', () => {
      const cases = [
        [5, 5],
        ['100', 100],
        [500, 500],
        ['-487', -487],
        ['99.5', 99.5],
      ];
      testExpressionCases('$toNumber', cases);
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
    const data: Record<string, any>[] = [
      { _id: 1, item: null },
      { _id: 2 },
      { _id: 3, item: 'widget' },
    ];

    async function attempt(
      criteria: ServerQuery,
      expected: Record<string, any>[],
    ) {
      const res = await find(data, criteria);
      expect(res).to.have.deep.members(expected);
    }

    it('should return documents comparing with null', async () => {
      const expected: Record<string, any>[] = [
        { _id: 1, item: null },
        { _id: 2 },
      ];
      await attempt({ 'data.item': null }, expected);
    });

    it('should return documents using $type:"null"', async () => {
      const query = { 'data.item': { $type: 'null' } };
      const expected: Record<string, any>[] = [
        { _id: 1, item: null },
        { _id: 2 },
      ];
      // note: $type: does not distinguish between null and missing fields, sor {_id:2} is also returned
      await attempt(query, expected);
    });

    it('should return documents without missing or null field', async () => {
      const query = { 'data.item': { $exists: true } };
      // note: $exists: does not distinguish between null and missing fields, so only {_id:3} is also returned
      const expected = [{ _id: 3, item: 'widget' }];
      await attempt(query, expected);
    });
  });

  describe('Text Search', () => {
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

        const { jobs } = await queue.search('wait', 'translate');
        expect(jobs.length).to.equal(2);

        const { jobs: jobs1 } = await queue.search('wait', 'inference');
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

        const { jobs } = await queue.search('wait', query);
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

        const { jobs: foundJobs } = await queue.search('wait', searchTerm);
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
        const { jobs } = await queue.search('wait', 'occurred');

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
        const { jobs } = await queue.search('wait', 'timeout');

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
        await updateJob(added[0], { returnvalue: returnValue });
        const returnValue1 = JSON.stringify({ value: 42, status: 'success' });
        await updateJob(added[1], { returnvalue: returnValue1 });

        const { jobs: successful } = await queue.search('wait', 'success');
        expect(successful.length).to.equal(1);
        expect(successful[0].name).to.equal('second');

        const { jobs: failed } = await queue.search('wait', '"99"');
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

        const { jobs } = await queue.search(
          'wait',
          'alpha OR beta OR gamma OR epsilon',
        );
        expect(jobs.length).to.equal(3);
        const names = jobs.map(x => x.name).sort();
        expect(names).to.eql(['alpha', 'default', 'inference']);
      });

      it('should handle wildcard searches', async () => {
        const data = [
          { name: 'alpha-one', data: { _id: 1 } },
          { name: 'beta-two', data: { _id: 2 } },
          { name: 'gamma-three', data: { _id: 3 } },
          { name: 'delta-four', data: { _id: 4 } },
        ];
        await queue.addBulk(data);
        const { jobs } = await queue.search('waiting', 'a*-t*ree');
        expect(jobs.length).to.equal(1);
        expect(jobs[0].name).to.eql('gamma-three');

        const { jobs: jobs1 } = await queue.search('waiting', 'delta?four');
        expect(jobs1.length).to.equal(1);
        expect(jobs1[0].data).to.eql({ _id: 4 });
      });

      it('should handle phrase searches', async () => {
        const data = [
          {
            name: 'task-one',
            data: { _id: 1, description: 'quick brown fox' },
          },
          { name: 'task-two', data: { _id: 2, description: 'lazy dog' } },
          {
            name: 'task-three',
            data: { _id: 3, description: 'the quick blue hare' },
          },
        ];
        await queue.addBulk(data);
        const { jobs } = await queue.search('waiting', '"quick brown"');
        expect(jobs.length).to.equal(1);
        expect(jobs[0].name).to.eql('task-one');

        const { jobs: jobs1 } = await queue.search('waiting', '"quick"');
        expect(jobs1.length).to.equal(2);
        const names = jobs1.map(j => j.name).sort();
        expect(names).to.eql(['task-one', 'task-three']);
      });

      it('should handle regex searches', async () => {
        const data = [
          {
            name: 'task-one',
            data: { _id: 1, description: 'quick brown fox' },
          },
          { name: 'task-two', data: { _id: 2, description: 'lazy dog' } },
          {
            name: 'task-three',
            data: { _id: 3, description: 'the quick blue hare' },
          },
        ];
        await queue.addBulk(data);
        const { jobs } = await queue.search('waiting', '/qu.*k b.*n/');
        expect(jobs.length).to.equal(1);
        expect(jobs[0].name).to.eql('task-one');
      });

      it('should handle negation in searches', async () => {
        const data = [
          {
            name: 'task-one',
            data: { _id: 1, description: 'quick brown fox' },
          },
          { name: 'task-two', data: { _id: 2, description: 'lazy dog' } },
          {
            name: 'task-three',
            data: { _id: 3, description: 'the quick blue hare' },
          },
        ];
        await queue.addBulk(data);
        const { jobs } = await queue.search('waiting', 'quick NOT fox');
        expect(jobs.length).to.equal(1);
        expect(jobs[0].name).to.eql('task-three');
      });

      // Logical operator tests for Text Search
      it('should handle explicit AND operator', async () => {
        const data = [
          { name: 'alpha', data: { _id: 1 } },
          { name: 'beta', data: { _id: 2 } },
          { name: 'alpha-beta', data: { _id: 3 } },
        ];
        await queue.addBulk(data);
        const { jobs } = await queue.search('waiting', 'alpha AND beta');
        expect(jobs.length).to.equal(1);
        expect(jobs[0].name).to.equal('alpha-beta');
      });

      it('should handle implicit AND between terms', async () => {
        const data = [
          { name: 'quick brown', data: { _id: 1 } },
          { name: 'quick fox', data: { _id: 2 } },
          { name: 'brown fox', data: { _id: 3 } },
          { name: 'quick brown fox', data: { _id: 4 } },
        ];
        await queue.addBulk(data);
        const { jobs } = await queue.search('waiting', 'quick brown'); // implicit AND
        const names = jobs.map(j => j.name).sort();
        expect(names).to.eql(['quick brown', 'quick brown fox'].sort());
      });

      it('should respect parentheses and precedence', async () => {
        const data = [
          { name: 'a b c', data: { _id: 1 } },
          { name: 'a b', data: { _id: 2 } },
          { name: 'b c', data: { _id: 3 } },
          { name: 'c only', data: { _id: 4 } },
        ];
        await queue.addBulk(data);
        const { jobs } = await queue.search('waiting', '(a OR b) AND c');
        const names = jobs.map(j => j.name).sort();
        expect(names).to.eql(['a b c', 'b c'].sort());
      });

      it('should handle combined OR and NOT', async () => {
        const data = [
          { name: 'fast fox', data: { _id: 1 } },
          { name: 'slow fox', data: { _id: 2 } },
          { name: 'fast dog', data: { _id: 3 } },
          { name: 'slow dog', data: { _id: 4 } },
        ];
        await queue.addBulk(data);
        const { jobs } = await queue.search(
          'waiting',
          '(fast OR slow) NOT dog',
        );
        const names = jobs.map(j => j.name).sort();
        expect(names).to.eql(['fast fox', 'slow fox'].sort());
      });

      it('should handle the XOR operator', async () => {
        const data = [
          { name: 'red blue', data: { _id: 1 } },
          { name: 'red green', data: { _id: 2 } },
          { name: 'blue green', data: { _id: 3 } },
          { name: 'red blue green', data: { _id: 4 } },
        ];
        await queue.addBulk(data);
        const { jobs } = await queue.search('waiting', 'red ^ blue');
        const names = jobs.map(j => j.name).sort();
        expect(names).to.eql(['blue green', 'red green']);
      });
    });
    describe('When performing a fielded Search', () => {
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

        let inventoryJobs: Job[];

        beforeEach(async () => {
          inventoryJobs = await queue.addBulk(inventory);
        });

        describe('Numeric Ranges', () => {
          it('should handle closed range [min TO max]', async () => {
            const query = 'data.price:[25.99 TO 45.99]';
            const { jobs } = await queue.search('waiting', query);
            expect(jobs.length).to.equal(3);
            const prices = jobs.map(j => j.data.price).sort();
            expect(prices).to.eql([25.99, 35.99, 45.99]);
          });

          it('should handle open range {min TO max}', async () => {
            const query = 'data.qty:{180 TO 300}';
            const { jobs } = await queue.search('waiting', query);
            const expected = inventory.filter(
              job => job.data.qty > 180 && job.data.qty < 300,
            );
            expect(jobs.length).to.equal(expected.length);
            for (const job of jobs) {
              expect(job.data.qty).to.be.greaterThan(180);
              expect(job.data.qty).to.be.lessThan(300);
            }
          });

          it('should handle left-open, right-closed range {min TO max]', async () => {
            const query = 'data.price:{35.99 TO 55.99]';
            const { jobs } = await queue.search('waiting', query);
            expect(jobs.length).to.equal(2);
            const prices = jobs.map(j => j.data.price).sort();
            expect(prices).to.eql([45.99, 55.99]);
          });

          it('should handle left-closed, right-open range [min TO max}', async () => {
            const query = 'data.qty:[250 TO 300}';
            const { jobs } = await queue.search('waiting', query);
            expect(jobs.length).to.equal(1);
            expect(jobs[0].data.qty).to.equal(250);
          });

          it('should handle unbounded ranges with wildcards', async () => {
            const query = 'data.price:[45.99 TO *]';
            const { jobs } = await queue.search('waiting', query);
            expect(jobs.length).to.equal(2);
            const prices = jobs.map(j => j.data.price).sort();
            expect(prices).to.eql([45.99, 55.99]);
          });
        });

        describe('String Ranges', () => {
          it('should handle closed range for strings [min TO max]', async () => {
            const query = 'name:[bob TO david]';
            const { jobs } = await queue.search('waiting', query);
            expect(jobs.length).to.equal(3);
            const codes = jobs.map(j => j.name).sort();
            expect(codes).to.eql(['bob', 'chris', 'david']);
          });

          it('should handle open range for strings {min TO max}', async () => {
            const query = 'data.item:{abc TO xyz}';
            const { jobs } = await queue.search('waiting', query);
            const expected = inventory.filter(
              job => job.data.item > 'abc' && job.data.item < 'xyz',
            );
            expect(jobs.length).to.equal(expected.length);
            const expectedItems = expected.map(j => j.data.item).sort();
            const items = jobs.map(j => j.data.item).sort();
            expect(items).to.eql(expectedItems);
          });

          it('should handle mixed ranges for strings [min TO max}', async () => {
            const query = 'data.code:[B456 TO E345}';
            const { jobs } = await queue.search('waiting', query);
            const expected = inventory.filter(
              job => job.data.code >= 'B456' && job.data.code < 'E345',
            );
            expect(jobs.length).to.equal(expected.length);
            const expectedCodes = expected.map(j => j.data.code).sort();
            const codes = jobs.map(j => j.data.code).sort();
            expect(codes).to.eql(expectedCodes);
          });

          it('should handle unbounded string ranges', async () => {
            const query = 'data.item:["VWZ*" TO *]';
            const { jobs } = await queue.search('waiting', query);
            const expected = inventory.filter(job => job.data.item >= 'VWZ');
            expect(jobs.length).to.equal(expected.length);
            const expectedItems = expected.map(j => j.data.item).sort();
            const items = jobs.map(j => j.data.item).sort();
            expect(items).to.eql(expectedItems);
          });
        });

        describe('Invalid Ranges', () => {
          it('should raise on malformed range queries', async () => {
            const query = 'data.price:[45.99]'; // Missing TO
            let error: any = null;
            try {
              await queue.search('waiting', query);
            } catch (err) {
              error = err;
            }
            expect(error.toString()).to.contain('Invalid range query');
          });

          it('should handle invalid range bounds', async () => {
            const query = 'data.price:[abc TO def]'; // Invalid numeric bounds
            const { jobs } = await queue.search('waiting', query);
            expect(jobs.length).to.equal(0);
          });
        });
      });

      it('should search special fields', async () => {
        const data = [
          { name: 'task-one', data: { description: 'first task' } },
          { name: 'task-two', data: { description: 'second task' } },
          { name: 'task-three', data: { description: 'third task' } },
        ];

        const RUNTIME = 520;
        const WAIT_TIME = 2500;
        const now = Date.now();

        // runtime, waitTime, logs, and fullText are special "virtual" fields
        const savedJobs = await queue.addBulk(data);
        await updateJob(savedJobs[1], {
          processedOn: `${now + WAIT_TIME}`,
          finishedOn: `${now + WAIT_TIME + RUNTIME}`,
        });
        await savedJobs[0].log('alpha log entry');
        await savedJobs[0].log('beta log entry');
        await savedJobs[2].log('gamma log entry');

        let query = `runtime:[500 TO 600]`;
        const { jobs: runtimeJobs } = await queue.search('waiting', query);
        expect(runtimeJobs.length).to.equal(1);
        expect(runtimeJobs[0].name).to.equal('task-two');

        query = `waitTime:[2000 TO 3000]`;
        const { jobs: waitTimeJobs } = await queue.search('waiting', query);
        expect(waitTimeJobs.length).to.equal(1);
        expect(waitTimeJobs[0].name).to.equal('task-two');

        query = `logs:*alpha*`;
        const { jobs: logJobs } = await queue.search('waiting', query);
        expect(logJobs.length).to.equal(1);
        expect(logJobs[0].name).to.equal('task-one');

        const FULLTEXT_QUERY = 'fullText:(gamma OR beta OR *second*)';
        const { jobs: fullTextJobs } = await queue.search(
          'waiting',
          FULLTEXT_QUERY,
        );
        expect(fullTextJobs.length).to.equal(3);
      });

      it('should search for null values in fields', async () => {
        const data = [
          { name: 'task-one', data: { description: null } },
          { name: 'task-two', data: {} },
          { name: 'task-three', data: { description: 'third task' } },
        ];

        await queue.addBulk(data);

        const { jobs } = await queue.search('waiting', 'data.description:null');
        expect(jobs.length).to.equal(1);
        expect(jobs[0].name).to.eql('task-one');
      });

      it('can find null fields using the _exists_ special field', async () => {
        const data = [
          { name: 'task-one', data: { description: null } },
          { name: 'task-two', data: {} },
          { name: 'task-three', data: { description: 'third task' } },
        ];

        await queue.addBulk(data);
        const { jobs } = await queue.search(
          'waiting',
          '_exists_:data.description',
        );
        expect(jobs.length).to.equal(1);
        expect(jobs[0].name).to.equal('task-three');
      });
    });
    describe('Logical Operators', () => {
      let job: Job;

      beforeEach(async () => {
        job = await queue.add('default', Person);
      });

      describe('$and', () => {
        it('can use conjunction true AND true', async () => {
          const data = [
            {
              name: 'task-one',
              data: { title: 'Software Engineer', location: 'Remote' },
            },
            {
              name: 'task-two',
              data: { title: 'Software Engineer', location: 'Office' },
            },
            {
              name: 'task-three',
              data: { title: 'Data Scientist', location: 'Remote' },
            },
          ];
          await queue.addBulk(data);
          const { jobs } = await queue.search(
            'waiting',
            'data.title:Software* AND data.location:Remote',
          );
          expect(jobs.length).to.equal(1);
          expect(jobs[0].name).to.equal('task-one');
        });

        it('can use conjunction true AND false', async () => {
          const data = [
            {
              name: 'task-one',
              data: { title: 'Engineer', location: 'Remote' },
            },
            {
              name: 'task-two',
              data: { title: 'Engineer', location: 'Office' },
            },
          ];
          await queue.addBulk(data);
          const { jobs } = await queue.search(
            'waiting',
            'data.title:Engineer AND data.location:Hybrid',
          );
          expect(jobs.length).to.equal(0);
        });
      });

      describe('$or', () => {
        it('can use conjunction true OR true', async () => {
          const data = [
            { name: 'task-one', data: { language: 'Python' } },
            { name: 'task-two', data: { language: 'Javascript' } },
            { name: 'task-three', data: { language: 'Java' } },
          ];
          await queue.addBulk(data);
          const { jobs } = await queue.search(
            'waiting',
            'data.language:Python OR data.language:Javascript',
          );
          expect(jobs.length).to.equal(2);
          const names = jobs.map(j => j.name).sort();
          expect(names).to.eql(['task-one', 'task-two']);
        });

        it('can use conjunction true OR false', async () => {
          const data = [
            { name: 'task-one', data: { status: 'active' } },
            { name: 'task-two', data: { status: 'pending' } },
          ];
          await queue.addBulk(data);
          const { jobs } = await queue.search(
            'waiting',
            'data.status:active OR data.status:completed',
          );
          expect(jobs.length).to.equal(1);
          expect(jobs[0].name).to.equal('task-one');
        });

        it('can use conjunction false OR false', async () => {
          const data = [
            { name: 'task-one', data: { category: 'frontend' } },
            { name: 'task-two', data: { category: 'backend' } },
          ];
          await queue.addBulk(data);
          const { jobs } = await queue.search(
            'waiting',
            'data.category:mobile OR data.category:devops',
          );
          expect(jobs.length).to.equal(0);
        });
      });

      describe('$xor', () => {
        it('can use conjunction true XOR true', async () => {
          const data = [
            { name: 'task-one', data: { hasTests: true, hasDocs: true } },
            { name: 'task-two', data: { hasTests: true, hasDocs: false } },
            { name: 'task-three', data: { hasTests: false, hasDocs: true } },
          ];
          await queue.addBulk(data);
          const { jobs } = await queue.search(
            'waiting',
            'data.hasTests:true ^ data.hasDocs:true',
          );
          expect(jobs.length).to.equal(2);
          const names = jobs.map(j => j.name).sort();
          expect(names).to.eql(['task-three', 'task-two']);
        });

        it('can use conjunction true XOR false', async () => {
          const data = [
            { name: 'task-one', data: { priority: 'high', urgent: false } },
            { name: 'task-two', data: { priority: 'low', urgent: false } },
          ];
          await queue.addBulk(data);
          const { jobs } = await queue.search(
            'waiting',
            'data.priority:high ^ data.urgent:true',
          );
          expect(jobs.length).to.equal(1);
          expect(jobs[0].name).to.equal('task-one');
        });

        it('can use conjunction false XOR false', async () => {
          const data = [
            { name: 'task-one', data: { reviewed: false, approved: false } },
          ];
          await queue.addBulk(data);
          const { jobs } = await queue.search(
            'waiting',
            'data.reviewed:true ^ data.approved:true',
          );
          expect(jobs.length).to.equal(0);
        });
      });

      describe('$nor (NOT)', () => {
        it('can use negation with text search', async () => {
          const data = [
            { name: 'task-one', data: { environment: 'production' } },
            { name: 'task-two', data: { environment: 'staging' } },
            { name: 'task-three', data: { environment: 'development' } },
          ];
          await queue.addBulk(data);
          const { jobs } = await queue.search(
            'waiting',
            'data.environment:* NOT data.environment:production',
          );
          expect(jobs.length).to.equal(2);
          const names = jobs.map(j => j.name).sort();
          expect(names).to.eql(['task-three', 'task-two']);
        });

        it('can combine NOT with other operators', async () => {
          const data = [
            { name: 'task-one', data: { type: 'feature', status: 'done' } },
            { name: 'task-two', data: { type: 'bug', status: 'done' } },
            { name: 'task-three', data: { type: 'feature', status: 'todo' } },
          ];
          await queue.addBulk(data);
          const { jobs } = await queue.search(
            'waiting',
            'data.type:feature NOT data.status:done',
          );
          expect(jobs.length).to.equal(1);
          expect(jobs[0].name).to.equal('task-three');
        });
      });
    });
  });
});
