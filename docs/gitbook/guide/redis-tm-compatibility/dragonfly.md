# Dragonfly

[Dragonfly](https://www.dragonflydb.io/) offers a drop-in replacement for Redis™, boasting a much faster and more memory-efficient implementation of several data structures used by BullMQ. It also enables the utilization of all available cores in your CPUs. Check [this article](https://bullmq.io/news/101023/dragonfly-compatibility/) for some performance results.

To fully leverage Dragonfly's capabilities, specific steps are necessary. Primarily, you should name your queues using curly braces. This naming convention allows Dragonfly to assign a thread to each queue. For instance, if your queue is named `myqueue,`rename it to `{myqueue}`.

If you manage multiple queues, this approach enables you to allocate different CPU cores to each queue, significantly enhancing performance. Even with a single queue, you can still exploit multi-core advantages in some cases. Consider splitting your queue into multiple ones, like`{myqueue-1}`, `{myqueue-2}`, etc., and distribute jobs randomly or using a round-robin method.

{% hint style="info" %}
Be aware that certain features like priorities and rate-limiting might not function across multiple queues. Your specific requirements will determine whether you can divide a single queue in this manner.
{% endhint %}

For comprehensive instructions and the necessary flags to optimize your Dragonfly instance for BullMQ, please consult the [official integration guide](https://www.dragonflydb.io/docs/integrations/bullmq).
