package io.bullmq.core.events;

import io.bullmq.core.QueueBackend;
import io.bullmq.core.options.QueueEventsOptions;

import java.util.List;

/**
 * Listens to Redis events emitted by queues and workers.
 */
public class QueueEvents implements AutoCloseable {
    private final String name;
    private final QueueEventsOptions opts;
    private final QueueBackend backend;
    private volatile boolean closing = false;
    private Thread listenerThread;

    public QueueEvents(String name, QueueEventsOptions opts, QueueBackend backend) {
        this.name = name;
        this.opts = opts != null ? opts : new QueueEventsOptions();
        this.backend = backend;

        try {
            backend.waitUntilReady();

            if (opts.isAutorun()) {
                runAsync();
            }
        } catch (Exception e) {
            throw new RuntimeException("Failed to initialize queue events", e);
        }
    }

    /**
     * Starts listening to events (only needed when {@link QueueEventsOptions#isAutorun()} is
     * disabled).
     */
    public void runAsync() {
        if (listenerThread != null && listenerThread.isAlive()) {
            return;
        }

        listenerThread = new Thread(this::listenForEvents);
        listenerThread.setDaemon(true);
        listenerThread.start();
    }

    private void listenForEvents() {
        String lastId = opts.getLastEventId() != null ? opts.getLastEventId() : "$";

        while (!closing) {
            try {
                List<io.bullmq.core.EventEntry> events = backend.readEvents(lastId, opts.getBlockingTimeout() / 1000.0);
                for (io.bullmq.core.EventEntry event : events) {
                    // Process event - in a real implementation, we'd parse the event data
                    // and emit corresponding events to listeners
                    lastId = event.getId();
                }
            } catch (Exception e) {
                if (!closing) {
                    // Handle error - in real implementation would have error listeners
                    e.printStackTrace();
                }
                try {
                    Thread.sleep(1000);
                } catch (InterruptedException ex) {
                    Thread.currentThread().interrupt();
                    break;
                }
            }
        }
    }

    @Override
    public void close() {
        closing = true;
        if (listenerThread != null) {
            listenerThread.interrupt();
            try {
                listenerThread.join(1000);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
        backend.close();
    }
}