# Observables

Instead of returning regular promises, your workers can also return an Observable, this allows for some more advanced uses cases:

* It makes it possible to cleanly cancel a running job.
* You can define a "Time to live" (TTL) so that jobs that take too long time will be automatically canceled.
* Since the last value returned by the observable is persisted, you could retry a job and continue where you left of, for example, if the job implements a state machine or similar.

If you are new to Observables you may want to read this [introduction](https://www.learnrxjs.io/learn-rxjs/concepts/rxjs-primer). The two biggest advantages that Observables have over Promises are that they can emit more than 1 value and that they are cancelable.

Let's see a silly example of a worker making use of Observables:

```typescript
import { WorkerPro } from "@taskforcesh/bullmq-pro"
import { Observable } from "rxjs"

const processor = async () => {
  return new Observable<number>(subscriber => {
    subscriber.next(1);
    subscriber.next(2);
    subscriber.next(3);
    const intervalId = setTimeout(() => {
      subscriber.next(4);
      subscriber.complete();
    }, 500);

    // Provide a way of canceling and disposing the interval resource
    return function unsubscribe() {
      clearInterval(intervalId);
    };
  });
};

const worker = new WorkerPro(queueName, processor, { connection });
  
```

In the example above, the observable will emit 4 values, the first 3 directly and then a 4th after 500 ms. Also note that the "subscriber" returns a "unsubscribe" function. This is the function that will be called if the Observable is cancelled, so this is where you would do the necessary clean up.

You may be asking whats the use of returning several values for a worker. One case that comes to mind is if you have a larger processor and you want to make sure that if the process crashes you can continue from the latest value. You could do this with a simple switch-case on the return value, something like this:

```typescript
import { WorkerPro } from "@taskforcesh/bullmq-pro"
import { Observable } from "rxjs"

const processor = async (job) => {
  return new Observable<number>(subscriber => {
    switch(job.returnvalue){
      default:
        subscriber.next(1);
      case 1:
        subscriber.next(2);
      case 2:
        subscriber.next(3);
      case 3:
        subscriber.complete();
    }
  });
};

const worker = new WorkerPro(queueName, processor, { connection });
```
