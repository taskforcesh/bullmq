# BullMQ Java

A Java 17 and Spring Boot 3 port of the BullMQ library for reliable Redis-based job queues.

## Features

- ✅ Job queuing with priority, delay, and repeat options
- ✅ Concurrent job processing with workers
- ✅ Job lifecycle tracking (waiting, active, completed, failed, delayed, etc.)
- ✅ Events system for monitoring queue activity
- ✅ Job scheduling (repeatable jobs)
- ✅ Rate limiting
- ✅ Job progress tracking
- ✅ Job logs
- ✅ Spring Boot auto-configuration
- ✅ Lettuce-based Redis client
- ✅ Atomic operations using Lua scripts
- ✅ Testcontainers support for integration testing

## Installation

Add the dependency to your Maven `pom.xml`:

```xml
<dependency>
    <groupId>io.bullmq</groupId>
    <artifactId>bullmq</artifactId>
    <version>0.0.1-SNAPSHOT</version>
</dependency>
```

Or Gradle:

```groovy
implementation 'io.bullmq:bullmq:0.0.1-SNAPSHOT'
```

## Usage

### Basic Setup

```java
@SpringBootApplication
public class MyApplication {
    public static void main(String[] args) {
        SpringApplication.run(MyApplication.class, args);
    }
}
```

### Configuration

Configure BullMQ in your `application.yml` or `application.properties`:

```yaml
bullmq:
  prefix: "bullmq:"  # Redis key prefix (default: "bull")
  connection:
    connectionString: "redis://localhost:6379"
  queue:
    defaultJobOptions:
      attempts: 3
      removeOnComplete: true
      removeOnFail: true
  worker:
    concurrency: 5
    lockDuration: 30000
```

### Creating a Queue

```java
@Autowired
private Queue myQueue;

// Add a job
Job job = myQueue.add("process-user", 
        Map.of("userId", 123, "action", "update-profile"),
        new JobsOptions()
                .setDelay(5000) // Delay 5 seconds
                .setPriority(1) // High priority
                .setAttempts(3));

System.out.println("Added job with ID: " + job.getId());
```

### Creating a Worker

```java
@Component
public class UserWorker {
    
    @Autowired
    private Queue userQueue;
    
    @PostConstruct
    public void startWorker() {
        Worker worker = new Worker.Builder()
                .setName("user-processor")
                .setProcessor(job -> {
                    Map<String, Object> data = job.getData();
                    Integer userId = (Integer) data.get("userId");
                    String action = (String) data.get("action");
                    
                    System.out.println("Processing " + action + " for user " + userId);
                    
                    // Your business logic here
                    // Return the result
                    return Map.of("status", "success", "userId", userId);
                })
                .setOptions(new WorkerOptions()
                        .setConcurrency(3)
                        .setLockDuration(60000))
                .build(userQueue); // Assuming proper constructor or builder
        
        // Worker starts automatically if autorun is true (default)
    }
}
```

### Listening to Events

```java
@Component
public class QueueListener {
    
    @Autowired
    private QueueEvents queueEvents;
    
    @PostConstruct
    public void startListening() {
        // QueueEvents starts automatically if autorun is true (default)
        // Add event listeners as needed
    }
}
```

### Job Options

#### JobsOptions
- `jobId`: Custom job ID (cannot be "0" or start with "0:")
- `delay`: Milliseconds to delay before job becomes available
- `priority`: Job priority (1 = highest)
- `attempts`: Number of retry attempts
- `backoff`: Backoff strategy for retries
- `lifo`: Add to right of queue (LIFO) if true
- `timestamp`: Creation timestamp (defaults to now)
- `removeOnComplete`: Remove job on completion (true/false/number/KeepJobs)
- `removeOnFail`: Remove job on failure
- `keepLogs`: Number of log entries to keep

#### WorkerOptions
- `concurrency`: Number of concurrent jobs to process
- `lockDuration`: Lock duration in milliseconds
- `lockRenewTime`: Lock renewal interval (defaults to lockDuration/2)
- `drainDelay`: Seconds to block waiting for a job
- `name`: Human-readable worker name
- `autorun`: Start processing automatically
- `maxStalledCount`: Max stalled recoveries before failing
- `stalledInterval`: Interval to check for stalled jobs
- `skipStalledCheck`: Disable stalled job checker
- `skipLockRenewal`: Disable lock renewal

#### RepeatOptions
For creating repeatable jobs (cron-like scheduling):
- `pattern`: Cron expression (mutually exclusive with every)
- `every`: Fixed interval in milliseconds (mutually exclusive with pattern)
- `limit`: Maximum iterations
- `offset`: Millisecond offset for each iteration
- `immediately`: Run first iteration immediately
- `startDate`: Start date (ms since epoch or ISO string)
- `endDate`: End date (no iterations after this)
- `tz`: Timezone for cron expression
- `count`: Current iteration count (internal)
- `prevMillis`: Previous iteration time (internal)

## Spring Integration

BullMQ provides Spring Boot auto-configuration. When the library is on the classpath, it will automatically:

1. Configure a `RedisClient` Lettuce connection
2. Create a `QueueBackend` backend
3. Provide a default `Queue` bean
4. Provide a `QueueEvents` bean for listening to events

You can customize the configuration using `application.properties` or `application.yml` under the `bullmq` prefix.

## Example Application

See `io.bullmq.example.BullMQExampleApplication` for a complete example.

## Testing

For integration testing, use Testcontainers with Redis:

```java
@Testcontainers
public class BullMQIntegrationTest {
    @Container
    static final RedisContainer REDIS = new RedisContainer("redis:7-alpine");
    
    @DynamicPropertySource
    static void redisProperties(DynamicPropertyRegistry registry) {
        registry.add("bullmq.connection.connectionString", 
                REDIS::getRedisReplicaUrl);
    }
    
    @Test
    void testJobProcessing() {
        // Your test code here
    }
}
```

## Building from Source

```bash
mvn clean install
```

## License

MIT License - see the [LICENSE](../LICENSE) file for details.

## Acknowledgments

This library is a port of the excellent [BullMQ](https://github.com/taskforcesh/bullmq) library by Taskforce.