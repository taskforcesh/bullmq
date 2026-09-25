package io.bullmq.spring;

import io.bullmq.core.QueueBackend;
import io.bullmq.core.RedisBackend;
import io.bullmq.core.Worker;
import io.bullmq.core.events.QueueEvents;
import io.bullmq.core.Job;
import io.bullmq.core.Queue;
import io.bullmq.core.options.ConnectionOptions;
import io.bullmq.core.options.JobsOptions;
import io.bullmq.core.options.QueueEventsOptions;
import io.bullmq.core.options.QueueOptions;
import io.bullmq.core.options.RepeatOptions;
import io.bullmq.core.options.WorkerOptions;
import io.bullmq.spring.config.BullMQProperties;
import io.lettuce.core.RedisClient;
import io.lettuce.core.api.StatefulRedisConnection;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.UUID;

/**
 * Auto-configuration for BullMQ.
 */
@Configuration
@ConditionalOnClass(RedisClient.class)
@EnableConfigurationProperties(BullMQProperties.class)
public class BullMQAutoConfiguration {
    private static final Logger log = LoggerFactory.getLogger(BullMQAutoConfiguration.class);

    @Bean
    @ConditionalOnMissingBean
    public RedisClient bullmqRedisClient(BullMQProperties properties) {
        ConnectionOptions connOpts = properties.getConnection();
        if (connOpts.getConnectionString() != null && !connOpts.getConnectionString().isEmpty()) {
            return RedisClient.create(connOpts.getConnectionString());
        }
        // Fallback to default client
        log.info("Using default Redis connection");
        return RedisClient.create();
    }

    @Bean
    @ConditionalOnMissingBean
    public QueueBackend bullmqQueueBackend(BullMQProperties properties, RedisClient redisClient) {
        ConnectionOptions connOpts = properties.getConnection();
        QueueOptions queueOpts = properties.getQueue();
        WorkerOptions workerOpts = properties.getWorker();

        boolean ownsConnection = connOpts.getConnectionString() != null &&
                !connOpts.getConnectionString().isEmpty();

        try {
            return RedisBackend.createAsync(
                    UUID.randomUUID().toString(), // Backend name - in practice would be queue-specific
                    connOpts,
                    workerOpts.getLockDuration(),
                    workerOpts.getName(),
                    false // withBlockingConnection - simplified
            );
        } catch (Exception e) {
            throw new RuntimeException("Failed to create BullMQ backend", e);
        }
    }

    @Bean
    @ConditionalOnMissingBean
    public Queue bullmqQueue(BullMQProperties properties, QueueBackend backend) {
        QueueOptions queueOpts = properties.getQueue();
        return new Queue(
                properties.getPrefix() + "default", // Default queue name
                queueOpts,
                backend
        );
    }

    @Bean
    @ConditionalOnMissingBean
    public QueueEvents bullmqQueueEvents(BullMQProperties properties, QueueBackend backend) {
        QueueEventsOptions eventsOpts = new QueueEventsOptions();
        eventsOpts.setPrefix(properties.getPrefix());
        eventsOpts.setAutorun(true);
        return new QueueEvents(
                properties.getPrefix() + "events",
                eventsOpts,
                backend
        );
    }
}