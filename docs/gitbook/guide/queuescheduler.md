# QueueScheduler

The QueueScheduler is a helper class used to manage stalled and delayed jobs for a given Queue.

This class automatically moves delayed jobs back to the waiting queue when it is the right time to process them. It also automatically checks for stalled jobs, i.e., detects jobs that are active but where the worker has either crashed or stopped working properly. [Stalled jobs](jobs/stalled.md) are moved back or failed depending on the settings selected when instantiating the class.

The reason for having this functionality in a separate class instead of in the workers \(as in Bull 3.x\) is because whereas you may want to have a large number of workers for parallel processing, for the scheduler you probably only want a couple of instances for each queue that requires delayed or stalled checks. One will be enough but you can have more just for redundancy.

