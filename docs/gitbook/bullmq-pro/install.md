# Install

In order to install BullMQ Pro you need to use a NPM token from [taskforce.sh](https://taskforce.sh).

With the token at hand just update or create a ._**npmrc**_ file in your app repository with the following contents:

```
@taskforcesh:registry=https://npm.taskforce.sh/
//npm.taskforce.sh/:_authToken=${NPM_TASKFORCESH_TOKEN}
always-auth=true
```

"NPM\_\_TASKFORCESH\_\_TOKEN" is an environment variable pointing to your token.

Then just install the @taskforcesh/bullmq-pro package as you would install any other package, with npm, yarn or pnpm:

```
yarn add @taskforcesh/bullmq-pro
```

In order to use BullMQ Pro just import the _Pro_ versions of the classes. These classes are subclasses of the open source BullMQ library with new functionality:

```typescript
import { QueuePro, WorkerPro } from '@taskforcesh/bullmq-pro';

const queue = new QueuePro('myQueue');

const worker = new WorkerPro('myQueue', async job => {
  // Process job
});
```

### Using Docker

If you use docker you must make sure that you also add the _**.npmrc**_ file above in your **Dockerfile**:

```docker
WORKDIR /app

ADD .npmrc /app/.npmr
```

