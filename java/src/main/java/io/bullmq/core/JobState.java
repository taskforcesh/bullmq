package io.bullmq.core;

/**
 * The lifecycle states a job can be in. The string values match the Redis
 * key/list names used by the shared Lua scripts.
 */
public enum JobState {
    COMPLETED,
    FAILED,
    DELAYED,
    ACTIVE,
    PRIORITIZED,
    WAITING,
    WAITING_CHILDREN,
    UNKNOWN
}

/**
 * Helpers for converting {@link JobState} to/from its wire string.
 */
class JobStateExtensions { // Made package-private

    JobStateExtensions() {
        // Utility class - prevent instantiation
    }

    static String toWireString(JobState state) {
        return switch (state) {
            case COMPLETED -> "completed";
            case FAILED -> "failed";
            case DELAYED -> "delayed";
            case ACTIVE -> "active";
            case PRIORITIZED -> "prioritized";
            case WAITING -> "waiting";
            case WAITING_CHILDREN -> "waiting-children";
            case UNKNOWN -> "unknown";
        };
    }

    static JobState fromWireString(String value) {
        return switch (value) {
            case "completed" -> JobState.COMPLETED;
            case "failed" -> JobState.FAILED;
            case "delayed" -> JobState.DELAYED;
            case "active" -> JobState.ACTIVE;
            case "prioritized" -> JobState.PRIORITIZED;
            case "waiting" -> JobState.WAITING;
            case "waiting-children" -> JobState.WAITING_CHILDREN;
            default -> JobState.UNKNOWN;
        };
    }
}