# BullMQ Feature Parity Tracker

With multi-language implementations of BullMQ, this tracker establishes an action/outcome focused approach to testing the alignment of each implementation against the base typescript implementation.

The following are the basic principle of the test approach:

- A `definitions.json` file containing a list of test definitions to run against each implementation.
- Each implemetation should provide 2 parity scripts:
  - Producer Script - Takes test definitions from `definitions.json` creates the jobs, then it's work is done.
  - Consumer Script - Takes test definitions from `definitions.json` and listens for jobs from the producer and executes them based on `simulation_details`.
- The two scripts are run in parallel, for different languages, the outcomes are evaluated by the runner.

## `definitions.json`

The `definitions.json` file contains a list of test definitions to run against each implementation. Each definition is an object with the following properties:

- `name` (unique) - The name of the test definition.
- `description` - A description of the what the test aims to achieve.
- `queue_name` (producer/consumer) - The name of the queue to use for the test.
- `simulation_details` (consumer) - An object with specific instructions for the consumer on how to simulate work.
  - `sleep` - A delay in milliseconds to simulate work being done by a worker.
  - `fail` - The number of times to throw an error to trigger a retry.
- `job` (producer) - A job configuration
  - `count` - The number of jobs the producer add to the queue.
  - `delay` - Delay in milliseconds, set by the producer when adding a job to a queue.
- `worker` (consumer) - A worker configuration
  - `concurrency` - The worker concurrency level.
- `outcomes` - Outcomes evaluated by the runner once all the tests have been completed.
  - `timeout` - How long to wait for the producer and consumer scripts before evaluating the outcomes.
  - `wait_time` [int, int] - The minimum and maximum amount of time expected between the producer registering the **first event** and the consumer registering the **first event**.
  - `total_time` [int, int] - The minimum and maximum amount of time expected between the producer registering the **first event** and the consumer registering the **last event**.
  - `job_time` [int, int] - The minimum and maximum amount of time expected for a job to complete.
  - `processing_time` [int, int] - The minimum and maximum amount of time expected for the consumer to complete all the jobs.
  - `run_count` [int: start_count, int: complete_count] - The number of times each job should be started and completed.

## Runner

The runner is a script responsible for coordinating the execution of the producer and consumer scripts.

The runner operates as follows:

1. Starts up an inmemory Redis server.
2. Setsup extra backend server's e.g. postgresql.
3. Starts the producer and consumer scripts.
4. Listens for ready states from the producer and consumer scripts.
5. Once both scripts are ready, the runner publishes a `start` signal and starts evaluating the outcomes as timeouts run out for each test.

The producer and consumer scripts are called with the following environment variables:

- `PARITY_TEST_ID` - The unique identifier for the current test.
- `PARITY_EVENTS_TOPIC` - The Redis topic the runner listens on for ready states and other updates.
- `PARITY_STORAGE_BACKEND` - The backend being used for the parity tests - `redis` or `postgres`.
- `PARITY_STORAGE_CONNECTION_STRING` - The connection string for the storage backend.
- `PARITY_RESULTS_TOPIC`
  - The Redis topic the runner listens on for test results.
  - This topic is different for the producer and consumer scripts to allow the runner to be the verifier of test results.

### Consumer / Producer Scripts Lifecycle

The scripts start up and read `definitions.json` then publishes the following events to the Redis events topic:

```json
{
  "event": "readiness",
  "source": "consumer/consumer",
  "test_id": "recieved-test-id"
}
```

The scripts then listens for `start` event from the runner before starting workers or creating jobs as defined in `definitions.json`.

```json
{
  "event": "start",
  "source": "runner",
  "test_id": "recieved-test-id"
}
```

The scripts should also listen for `stop` event from the runner to clean up resources.

```json
{
  "event": "stop",
  "source": "runner",
  "test_id": "recieved-test-id"
}
```

### Producer Scripts

Once the producer script receives the `start` event, it should create queues and jobs as defined in `definitions.json`.

The producer should generate a random test-secret for each test and job-secret for each job it creates.

The name of the job should be: `job-{zero-based-index}` based on the job count.

When creating jobs, the producer should include the payload:

```json
{
  "test_id": "recieved-test-id",
  "test_secret": "recieved-test-secret",
  "job_secret": "recieved-job-secret"
}
```

Once the job is created, the producer should then publish the following event to the results topic:

```json
{
  "event": "job-created",
  "timestamp": unix-milliseconds,
  "test_id": "recieved-test-id",
  "job_name": "job-{zero-based-index}",
  "test_secret": "generated-test-secret",
  "job_secret": "generated-job-secret"
}
```

### Consumer Scripts

Once the consumer script receives the `start` event, it should start workers and listen for jobs as defined in `definitions.json`.

Each worker should publish the following event to the results topic when a job is started:

```json
{
  "event": "job-started",
  "timestamp": unix-milliseconds,
  "test_id": "recieved-test-id",
  "job_name": "job-name-received",
  "test_secret": "recieved-test-secret",
  "job_secret": "recieved-job-secret"
}
```

The worker should then proceed to process `simulation_details` as follows:

- `sleep` - The worker should sleep for the duration specified in `simulation_details` before processing the job.
- `fail` - The worker should throw an error until the number of attempts equal to the count provided by `simulation_details`.

Once the simulation is complete, the worker should publish the following event to the results topic:

```json
{
  "event": "job-completed",
  "timestamp": unix-milliseconds,
  "test_id": "recieved-test-id",
  "job_name": "job-name-received",
  "test_secret": "recieved-test-secret",
  "job_secret": "recieved-job-secret"
}
```

### Report

The runner compiles a report for the test results once all the tests have been completed.
