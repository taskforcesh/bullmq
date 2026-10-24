import { expect } from 'vitest';
import { FlowProducer, Queue, Worker } from '../../src/classes';

export async function checkReaddedFlow(
  queue: Queue,
  flow: FlowProducer,
  worker: Worker,
  completedFirst: boolean,
  bulk: boolean,
  structure: 'siblings' | 'nested' | 'split',
): Promise<void> {
  const queueName = queue.name;
  const token = 'flow-registration-test';
  const cached = {
    queueName,
    name: 'cached',
    opts: { jobId: 'cached' },
  };

  await flow.add({
    queueName,
    name: 'parent',
    opts: { jobId: 'parent', removeOnComplete: true },
    children: [cached],
  });
  const cachedJob = await worker.getNextJob(token, { block: false });
  expect(cachedJob?.id).toBe('cached');
  await cachedJob!.moveToCompleted('cached result', token, false);
  const previousParent = await worker.getNextJob(token, { block: false });
  expect(previousParent?.id).toBe('parent');
  await previousParent!.moveToCompleted('first result', token, false);
  expect(await queue.getJob('parent')).toBeUndefined();

  const fresh = { queueName, name: 'fresh', opts: { jobId: 'fresh' } };
  const node = {
    queueName,
    name: 'parent',
    opts: { jobId: 'parent' },
    children: completedFirst ? [cached, fresh] : [fresh, cached],
  };
  let root;
  let tree;
  if (structure === 'nested') {
    root = await flow.add({ queueName, name: 'root', children: [node] });
    tree = root.children![0];
  } else if (structure === 'split') {
    [tree] = await flow.addBulk([
      { ...node, children: [cached] },
      {
        ...fresh,
        opts: {
          ...fresh.opts,
          parent: { id: 'parent', queue: queue.qualifiedName },
        },
      },
    ]);
  } else {
    tree = bulk ? (await flow.addBulk([node]))[0] : await flow.add(node);
  }

  expect(await tree.job.getState()).toBe('waiting-children');
  expect(await tree.job.getDependenciesCount()).toMatchObject({
    processed: 1,
    unprocessed: 1,
  });
  const next = await worker.getNextJob(token, { block: false });
  expect(next?.id).toBe('fresh');
  await next!.moveToCompleted('fresh result', token, false);

  const parent = await worker.getNextJob(token, { block: false });
  expect(parent?.id).toBe('parent');
  expect(Object.values(await parent!.getChildrenValues()).sort()).toEqual([
    'cached result',
    'fresh result',
  ]);
  await parent!.moveToCompleted('second result', token, false);
  expect(await tree.job.getState()).toBe('completed');
  if (root) {
    const rootJob = await worker.getNextJob(token, { block: false });
    expect(rootJob?.id).toBe(root.job.id);
    await rootJob!.moveToCompleted('root result', token, false);
  }
  expect(await worker.getNextJob(token, { block: false })).toBeUndefined();
}
