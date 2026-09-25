package io.bullmq.core;

import java.util.HashMap;
import java.util.Map;

/**
 * Generates Redis keys for BullMQ based on prefix and queue name.
 * Mirrors the functionality of the .NET QueueKeys class.
 */
public class QueueKeys {
    private final String prefix;

    public QueueKeys(String prefix) {
        this.prefix = prefix;
    }

    /**
     * Gets the qualified queue name (prefix:queueName).
     */
    public String getQueueQualifiedName(String queueName) {
        return prefix + queueName;
    }

    /**
     * Gets all standard keys for a queue.
     */
    public Map<String, String> getKeys(String queueName) {
        String qualified = getQueueQualifiedName(queueName);
        Map<String, String> keys = new HashMap<>();
        keys.put("", qualified + ":"); // Base key
        keys.put("marker", qualified + "marker");
        keys.put("active", qualified + "active");
        keys.put("wait", qualified + "wait");
        keys.put("paused", qualified + "paused");
        keys.put("completed", qualified + "completed");
        keys.put("failed", qualified + "failed");
        keys.put("delayed", qualified + "delayed");
        keys.put("prioritized", qualified + "prioritized");
        keys.put("waiting-children", qualified + "waiting-children");
        keys.put("pc", qualified + "pc"); // Priority counter
        keys.put("meta", qualified + "meta");
        keys.put("events", qualified + "events");
        keys.put("repeat", qualified + "repeat");
        keys.put("limiter", qualified + "limiter");
        keys.put("id", qualified + "id"); // Job ID counter
        return keys;
    }

    /**
     * Converts a key type to its full key name for a queue.
     */
    public String toKey(String queueName, String type) {
        Map<String, String> keys = getKeys(queueName);
        return keys.getOrDefault(type, "");
    }
}