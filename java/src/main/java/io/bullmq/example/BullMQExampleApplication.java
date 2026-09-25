package io.bullmq.example;

import io.bullmq.core.Job;
import io.bullmq.core.Queue;
import io.bullmq.core.Worker;
import io.bullmq.core.options.JobsOptions;
import io.bullmq.core.options.QueueOptions;
import io.bullmq.core.options.WorkerOptions;
import io.bullmq.spring.BullMQAutoConfiguration;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.ConfigurableApplicationContext;

/**
 * Example application showing how to use BullMQ Java.
 */
@SpringBootApplication
public class BullMQExampleApplication {
    public static void main(String[] args) throws InterruptedException {
        ConfigurableApplicationContext context = SpringApplication.run(BullMQExampleApplication.class, args);

        // Get the queue from Spring context
        Queue queue = context.getBean(Queue.class);

        // Add a job to the queue
        Job jobAdded = queue.add("example-job",
                java.util.Map.of("message", "Hello, BullMQ!"),
                new JobsOptions());

        System.out.println("Added job: " + jobAdded.getId());

        // Create a worker to process jobs
        Worker worker = new Worker(
                "example-worker",
                job -> {
                    System.out.println("Processing job: " + job.getId());
                    System.out.println("Job data: " + job.getData());
                    // Simulate work
                    Thread.sleep(1000);
                    return "Job completed successfully";
                },
                new WorkerOptions(),
                queue.getBackend() // Assuming we can get backend from queue
        );

        // Worker starts automatically if autorun is true (default)

        System.out.println("Example completed. In a real app, the worker would process jobs.");

        // Keep the app running for a bit to see output
        Thread.sleep(5000);

        context.close();
    }
}