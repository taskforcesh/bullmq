import { expect } from 'chai';
import { default as IORedis } from 'ioredis';
import { describe, beforeEach, it, before, after as afterAll } from 'mocha';
import { v4 } from 'uuid';
import { Queue } from '../src/classes';
import { removeAllQueueData } from '../src/utils';

describe('scripts', function () {
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';

  let queue: Queue;
  let queueName: string;

  let connection;
  before(async function () {
    connection = new IORedis(redisHost, { maxRetriesPerRequest: null });
  });

  beforeEach(async function () {
    queueName = `test-${v4()}`;
    queue = new Queue(queueName, { connection, prefix });
    await queue.waitUntilReady();
  });

  afterEach(async function () {
    await queue.close();
    await removeAllQueueData(new IORedis(redisHost), queueName);
  });

  afterAll(async function () {
    await connection.quit();
  });

  describe('.paginateSet', () => {
    const testSet = 'test-set';

    beforeEach(async () => {
      const client = await queue.client;
      await client.del(testSet);
    });

    it('should paginate a small set same size as set', async () => {
      const scripts = queue['scripts'];

      const client = await queue.client;
      await client.sadd(
        testSet,
        'a',
        'b',
        'c',
        'd',
        'e',
        'f',
        'g',
        'h',
        'i',
        'j',
      );

      const page = await scripts.paginate(testSet, { start: 0, end: 9 });

      page.items = page.items.sort();

      expect(page).to.be.eql({
        items: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'],
        cursor: '0',
        total: 10,
      });
    });

    it('should paginate a small set different size as set', async () => {
      const scripts = queue['scripts'];

      const members = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];

      const client = await queue.client;
      await client.sadd(testSet, ...members);

      const page = await scripts.paginate(testSet, { start: 3, end: 7 });

      expect(page.items).to.have.lengthOf(5);
      expect(page.cursor).to.be.eql('0');
      expect(page.total).to.be.eql(members.length);
    });

    it('should paginate a large set in pages of given size', async () => {
      const scripts = queue['scripts'];

      const client = await queue.client;

      const pageSize = 13;
      const numPages = 137;

      const totalItems = pageSize * numPages;

      const items = Array(totalItems)
        .fill(0)
        .map((_, i) => i);

      await client.sadd(testSet, ...items);

      const pagedItems: string[] = [];
      for (let i = 0; i < numPages; i++) {
        const start = i * pageSize;
        const end = start + pageSize - 1;
        const page = await scripts.paginate(testSet, { start, end });
        expect(page.items).to.have.lengthOf(pageSize);
        expect(page.total).to.be.eql(totalItems);
        pagedItems.push(...page.items);
      }

      const sortedItems = pagedItems
        .map(i => parseInt(i))
        .sort((a, b) => a - b);

      expect(sortedItems).to.be.eql(items);
    });
  });

  describe('.paginateHash', () => {
    const testHash = 'test-hash';

    beforeEach(async () => {
      const client = await queue.client;
      await client.del(testHash);
    });

    it('should paginate a small hash same size as hash', async () => {
      const scripts = queue['scripts'];

      const client = await queue.client;
      await client.hmset(testHash, {
        a: JSON.stringify('a'),
        b: JSON.stringify('b'),
        c: JSON.stringify('c'),
        d: JSON.stringify('d'),
        e: JSON.stringify('e'),
        f: JSON.stringify('f'),
        g: JSON.stringify('g'),
        h: JSON.stringify('h'),
        i: JSON.stringify('i'),
        j: JSON.stringify('j'),
      });

      const page = await scripts.paginate(testHash, { start: 0, end: 9 });

      expect(page).to.be.eql({
        items: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map(key => ({
          id: key,
          v: key,
        })),
        cursor: '0',
        total: 10,
      });
    });

    it('should paginate a small hash different size as hash', async () => {
      const scripts = queue['scripts'];

      const client = await queue.client;
      await client.hmset(testHash, {
        a: JSON.stringify('a'),
        b: JSON.stringify('b'),
        c: JSON.stringify('c'),
        d: JSON.stringify('d'),
        e: JSON.stringify('e'),
        f: JSON.stringify('f'),
        g: JSON.stringify('g'),
        h: JSON.stringify('h'),
        i: JSON.stringify('i'),
        j: JSON.stringify('j'),
      });

      const page = await scripts.paginate(testHash, { start: 3, end: 7 });

      expect(page.items).to.have.lengthOf(5);

      expect(page.items).to.be.eql(
        ['d', 'e', 'f', 'g', 'h'].map(key => ({ id: key, v: key })),
      );

      expect(page).to.be.eql({
        items: ['d', 'e', 'f', 'g', 'h'].map(key => ({ id: key, v: key })),
        cursor: '0',
        total: 10,
      });
    });

    it('should paginate a large hash in pages of given size', async () => {
      const scripts = queue['scripts'];

      const client = await queue.client;

      const pageSize = 13;
      const numPages = 137;

      const totalItems = pageSize * numPages;

      const items = Array(totalItems)
        .fill(0)
        .map((_, i) => ({ [i]: i }))
        .reduce((acc, item) => {
          const key = Object.keys(item)[0];
          acc[key] = item[key];
          return acc;
        });

      await client.hmset(testHash, items);

      const pagedItems: any[] = [];
      for (let i = 0; i < numPages; i++) {
        const start = i * pageSize;
        const end = start + pageSize - 1;

        const page = await scripts.paginate(testHash, { start, end });
        expect(page.items).to.have.lengthOf(pageSize);
        expect(page.total).to.be.eql(totalItems);
        pagedItems.push(...page.items);
      }

      const itemsObject = pagedItems.reduce((acc, item) => {
        acc = { ...acc, [item.id]: item.v };
        return acc;
      }, {});

      for (const key of Object.keys(itemsObject)) {
        itemsObject[key] = parseInt(itemsObject[key]);
      }

      expect(itemsObject).to.be.eql(items);
    });
  });
});
