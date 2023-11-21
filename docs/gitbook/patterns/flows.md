# Flows

{% hint style="warning" %}
The following pattern, although still useful, has been mostly super-seeded by the new [Flows](../guide/flows/) functionality
{% endhint %}

In some situations, you may need to execute a flow of several actions, any of which could fail. For example, you may need to update a database, make calls to external services, or any other kind of asynchronous call.

Sometimes it may not be possible to create an [idempotent job](idempotent-jobs.md) that can execute all these actions again in the case one of them failed for any reason. Instead, we may want to be able to only re-execute the action that failed and continue executing the rest of the actions that have not yet been executed.

The pattern to solve this issue consists of dividing the flow of actions into one queue for every action. When the first action completes, it places the next action as a job in its corresponding queue.
