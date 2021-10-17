# Install

In order to install BullMQ Pro you need to use a NPM token from [taskforce.sh](https://taskforce.sh). 

With the token at hand just update or create a ._**npmrc**_ file in your app repository with the following contents:

```
@taskforcesh:registry=https://npm.taskforce.run/
//npm.taskforce.run/:_authToken=${NPM_TASKFORCESH_TOKEN}
```

Then just install the @taskforcesh/bullmq-pro package as you would install any other package, with npm or yarn:

```
yarn add @taskforcesh/bullmq-pro
```
