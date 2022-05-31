# Returning Job Completions

A common pattern is where you have a cluster of queue processors that just process jobs as fast as they can, and some other services that need to take the result of these processors and do something with it, maybe storing results in a database.

\
The most robust and scalable way to accomplish this is by combining the standard job queue with the message queue pattern: a service sends jobs to the cluster just by opening a job queue and adding jobs to it, and the cluster will start processing as fast as it can. Everytime a job gets completed in the cluster a message is sent to a results message queue with the result data, and this queue is listened by some other service that stores the results in a database.



\
