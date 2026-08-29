# BullMQ Feature Parity Tracker

With multi-language implementations of BullMQ, this tracker establishes an action/outcome focused approach to testing the alignment of each implementation against the base typescript implementation.

The following are the basic principle of the test approach:

- A `definitions.json` file containing a list of test definitions to run against each implementation.
- Each implemetation should provide 2 parity scripts:
  - Producer Script - Takes test definitions from `definitions.json` creates the jobs, then it's work is done.
  - Consumer Script - Takes test definitions from `definitions.json` and listens for jobs from the producer and executes them based on `simulation_details`.
- The two scripts are run in parallel, for different languages, the outcomes are evaluated by the runner.

## Test Definitions File `definitions.json`

The `definitions.json` file contains a list of test definitions to run against each implementation. Each definition is an object with the following properties:

- `id` (unique) - The unique identifier of the test definition, this is also used as the queue name.
- `name` (unique) - The name of the test definition.
- `description` - A description of the what the test aims to achieve.
- `job` (producer) - A job configuration
  - `count` - The number of jobs the producer add to the queue.
  - `delay` - Delay in milliseconds, set by the producer when adding a job to a queue.
- `worker` (consumer) - A worker configuration
  - `concurrency` - The worker concurrency level.
- `simulation` (consumer) - An object with specific instructions for the consumer on how to simulate work.
  - `sleep` - A delay in milliseconds to simulate work being done by a worker.
  - `fail` - The number of times to throw an error to trigger a retry.
- `outcomes` - Outcomes evaluated by the runner once all the tests have been completed.
  - `wait_time`: {min, max} - The minimum and maximum amount of time expected between the producer registering the **first event** and the consumer registering the **first event**.
  - `processing_time`: {min, max} - The minimum and maximum amount of time expected for the consumer to complete all the jobs.
  - `exec_counts`: {start, complete} - The number of times each job should be started and completed.

## Runner

The runner is a script responsible for coordinating the execution of the producer and consumer scripts.

The runner operates as follows:

1. Starts up an inmemory Redis or Postgres server based on the backend required by the tests.
   - The host is always `localhost`
   - For postgres, the user name is `testuser`, password `testpassword` and database `testdb`
   - Since the backend instances are uniqueue for each test, tests are performed in parallel with each side acting as a producer or consumer.
2. Starts up the consumer script and waits until the consumer script is ready.
3. Starts up the producer script and waits until the producer script is ready.
4. The test time starts to count once the producer script confirms it's ready.
5. The runner starts evaluating the outcomes as timeouts run out for each test.

The producer and consumer scripts are called with the following environment variables:

- `PARITY_RUN_ID` - This is a UUID unique for every script call and used to distinguish test output events from other stderr/stdout data
- `PARITY_BACKEND` - The backend being used for the parity tests - `redis` or `postgres`.
- `PARITY_BACKEND_PORT` - The port to use to connect to redis or postgres for this test.

### Consumer / Producer Scripts Lifecycle

The scripts start up and read `definitions.json` then logs the following events to `stdout` as a single line

```json
{ "type": "ready", "run_id": "xxx" }
```

If the implementation doesn't support the backend specified in `PARITY_BACKEND`, it can emit the event below and the test will be skipped

```json
{ "type": "unsupported", "run_id": "xxx" }
```

Each script must log the ready event within 3 seconds of launch, the script will be killed and the test considered as failed.

- An optional timeout can be set for each script if necessary

### Producer Scripts

Once the producer script logs the ready event, it should create queues and jobs as defined in `definitions.json`.

The producer should generate a random **test-secret for each test** and **job-secret for each job** it creates.

The name of the job should be: `job-{zero-based-index}` based on the job count.

When creating jobs, the producer should include the payload:

```json
{
  "test_secret": "generated-test-secret",
  "job_secret": "generated-job-secret"
}
```

Once the job is created, the producer should log the event below to `stdout` as a single line.

```json
{"type": "job-created", "run_id": "xxx", "data": {"timestamp": unix-milliseconds, "test_id": "from-definitions", "job_name": "job-{n}", "test_secret": "generated-secret", "job_secret": "generated-secret"}}
```

**Note:**

- The producer can exit after creating all the jobs defined.
- If the producer exits before emitting the ready event, the test is automatically failed.

### Consumer Scripts

The consumer script is started before the producer script, it should start workers and listen for jobs as defined in `definitions.json`.

Once started, it logs the ready event for the producer script to start.

Each worker should publish the following event to the results topic when a job is started:

```json
{"type": "job-started", "run_id": "xxx", "data": {"timestamp": unix-milliseconds, "test_id": "from-definitions", "job_name": "job-{n}", "test_secret": "from-payload", "job_secret": "from-payload"}}
```

The worker should then proceed to process `simulation_details` as follows:

- `sleep` - The worker should sleep for the duration specified in `simulation_details` before processing the job.
- `fail` - The worker should throw an error until the number of attempts equal to the count provided by `simulation_details`.

Once the simulation is complete, the worker should publish the following event to the results topic:

```json
{"type": "job-completed", "run_id": "xxx", "data": {"timestamp": unix-milliseconds, "test_id": "from-definitions", "job_name": "job-{n}", "test_secret": "from-payload", "job_secret": "from-payload"}}
```

**Note:**

- The consumer script will be killed after the timeout of the test definition with the longest timeout.
- If the consumer script exits without being killed explicitly by the runner, the test is automatically failed.
- If the consumer produces events other than `ready` before the producer is created, the test is automatically failed.

### Report

The runner compiles a report for the test results once all the tests have been completed.
