package io.bullmq.core;

import java.util.List;

/**
 * Entry from the event stream.
 */
public class EventEntry {
    private final String id;
    private final List<String> fields;

    public EventEntry(String id, List<String> fields) {
        this.id = id;
        this.fields = fields;
    }

    public String getId() {
        return id;
    }

    public List<String> getFields() {
        return fields;
    }
}