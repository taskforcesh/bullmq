package io.bullmq.core;

/**
 * Holder for Lua scripts used by BullMQ.
 * In a production implementation, these would be loaded from resources.
 */
public final class LuaScripts {
    private LuaScripts() {
        // Utility class
    }

    // Script contents would go here - simplified for now
    public static final String ADD_STANDARD_JOB = ""; // Would contain actual Lua
    public static final String ADD_DELAYED_JOB = "";
    public static final String ADD_PRIORITIZED_JOB = "";
    // ... other scripts

    public static String get(String scriptName) {
        // In real implementation, would load from resources
        switch (scriptName) {
            case "addStandardJob": return ADD_STANDARD_JOB;
            case "addDelayedJob": return ADD_DELAYED_JOB;
            case "addPrioritizedJob": return ADD_PRIORITIZED_JOB;
            // ... other cases
            default: return "";
        }
    }
}