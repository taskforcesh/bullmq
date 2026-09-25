package io.bullmq;

import io.bullmq.core.Job;
import io.bullmq.core.Queue;
import io.bullmq.core.Worker;
import io.bullmq.core.options.JobsOptions;
import io.bullmq.core.options.QueueOptions;
import io.bullmq.core.options.WorkerOptions;
import io.bullmq.core.RedisBackend;
import io.bullmq.core.ConnectionOptions;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.junit.jupiter.SpringExtension;

import static org.junit.jupiter.api.Assertions.*;

@ExtendWith(SpringExtension.class)
@SpringBootTest
class BullMQApplicationTests {

    @Test
    void contextLoads() {
    }

    @Test
    void testQueueAndJobCreation() throws Exception {
        // Test basic queue and job creation
        ConnectionOptions connOpts = new ConnectionOptions("redis://localhost:6379");
        QueueOptions queueOpts = new QueueOptions();
        WorkerOptions workerOpts = new WorkerOptions();

        // This would normally connect to Redis - for unit test we might mock
        // For now, we'll just verify the objects can be created
        assertNotNull(connOpts);
        assertNotNull(queueOpts);
        assertNotNull(workerOpts);

        // Test job options
        JobsOptions jobOpts = new JobsOptions();
        jobOpts.setDelay(1000L);
        jobOpts.setPriority(1);
        jobOpts.setAttempts(3);

        assertEquals(1000L, jobOpts.getDelay());
        assertEquals(1, jobOpts.getPriority());
        assertEquals(3, jobOpts.getAttempts());
    }

    @Test
    void testJobStateEnum() {
        assertNotNull(io.bullmq.core.JobState.COMPLETED);
        assertNotNull(io.bullmq.core.JobState.FAILED);
        assertNotNull(io.bullmq.core.JobState.ACTIVE);
        assertEquals("completed", io.bullmq.core.JobStateExtensions.toWireString(io.bullmq.core.JobState.COMPLETED));
        assertEquals(io.bullmq.core.JobState.COMPLETED,
                io.bullmq.core.JobStateExtensions.fromWireString("completed"));
    }
}