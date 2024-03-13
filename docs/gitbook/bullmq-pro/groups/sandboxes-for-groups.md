# Sandboxes for groups

It is also possible to use [Sandboxes](../../guide/workers/sandboxed-processors.md) for processing groups.  It works essentially the same as in standard BullMQ, but you gain access to the "gid" property in the job object sent to your processor, for example:

```typescript
import { SandboxedJobPro } from '@taskforcesh/bullmq-pro';

module.exports = function (job: SandboxedJobPro) {
  expect(job).to.have.property('gid');
  expect(job.opts).to.have.property('group');
  expect(job.opts.group).to.have.property('id');
  expect(job.opts.group.id).to.be.a('string');
  expect(job.opts.group.id).to.equal(job.gid);
};
```



{% hint style="danger" %}
Groups are the only Pro features supported by Sandboxed processors for now.
{% endhint %}
