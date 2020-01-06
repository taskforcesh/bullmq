---
description: 'First-In, First-Out'
---

# FIFO

The first type of jobs we are going to describe is the FIFO \(First-In, First-Out\) type. This is the standard type when adding jobs to a queue. The jobs are processed in the order they are inserted into the queue. This order is preserved independently on the amount of processors you have, however if you have more than one worker or concurrency larger than 1, even though the workers will start the jobs in order, they may be completed in a slightly different order, since some jobs may take more time to complete than others.

