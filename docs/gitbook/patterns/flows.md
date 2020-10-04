# Flows

In some situations you need to execute a flow of actions that each and one of them could fail, it could be database updates, calls to external services, or any other kind of asynchronous call. 

Sometimes it may not be possible to create an idempotent job that can execute all these actions again in the case one of them failed for any reason, instead we want to be able to only re-execute the action that failed and continue executing the rest of the actions that have not yet been executed.

The pattern to solve this issue consists on dividing the flow of actions into one queue for every action. When the first action completes it places the next action as a job in its correspondent queue.

