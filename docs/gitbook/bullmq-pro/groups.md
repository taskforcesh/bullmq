# Groups

Groups allows you to use only one queue yet distribute the jobs among groups so that you the jobs from different groups are processed in a "fair manner".&#x20;

For example, image that you have 1 queue for processing video transcoding for all your users, you may have thousands of users in your application. You need to offload the transcoding operation since it is lengthy and CPU consuming. If you have many users that want to transcode many files, then in a non-grouped queue one user could fill the queue with jobs and the rest of the users will need to wait for that user to complete all its jobs before their jobs get processed.

Groups resolves this problem since jobs will be processed in a "[round-robin](https://en.wikipedia.org/wiki/Round-robin\_item\_allocation)" fashion among all the users.&#x20;

![](<../.gitbook/assets/image (1).png>)

Of course you can have as many workers as you want and also scale up/down the amount of workers depending on how many jobs you have in waiting in the queue.

{% hint style="info" %}
There is no hard limit on the amount of groups that you can have, nor do they have any impact on performance. When a group is empty, the group itself does not consume any resources in Redis.
{% endhint %}

Another way to see groups is like "virtual" queues. So instead of having one queue per "user" you have a "virtual" queue so that all users get their jobs processed in a more predictable way.

In order to use the group functionality just use the group property in the job options when adding a job:

```typescript

  const job1 = await queue.add('test', { foo: 'bar1' }, {
    group: {
      id: 1,
    },
  });
  
  const job2 = await queue.add('test', { foo: 'bar2' }, {
    group: {
      id: 2,
    },
  });

```

{% hint style="info" %}
You can add standard jobs to the same queue, in this case those jobs will have precedence over the grouped jobs.
{% endhint %}

