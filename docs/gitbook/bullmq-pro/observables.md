# Observables

Instead of returning regular promises, you can also return an Observable, this allows for some more advanced uses cases:

* It makes possible to cleanly cancel a running job.
* You can define a "Time to live" (TTL) so that jobs that take too long time will be automatically cancelled.
* Since the last value returned by the observable is persisted, you could retry a job and continue where you left of, for example if the job implements a state machine or similar.

