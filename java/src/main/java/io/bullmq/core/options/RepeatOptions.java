package io.bullmq.core.options;

import java.time.Instant;

/**
 * Options describing how a job scheduler repeats. Exactly one of
 * {@link #pattern} (a cron expression) or {@link #every} (a fixed
 * interval in milliseconds) must be provided.
 */
public class RepeatOptions {
    /**
     * A cron expression (5 or 6 fields). Mutually exclusive with {@code every}.
     */
    private String pattern;

    /**
     * A fixed interval in milliseconds. Mutually exclusive with {@code pattern}.
     */
    private Long every;

    /**
     * Maximum number of iterations to produce.
     */
    private Integer limit;

    /**
     * Offset (ms) applied to each iteration's scheduled time.
     */
    private Long offset;

    /**
     * When true, the first iteration is produced immediately.
     */
    private Boolean immediately;

    /**
     * Start date (ms since epoch or ISO 8601 string).
     */
    private Object startDate;

    /**
     * End date (ms since epoch or ISO 8601 string). No iterations after this.
     */
    private Object endDate;

    /**
     * IANA timezone name used to evaluate {@code pattern}.
     */
    private String tz;

    /**
     * Internal: the current iteration count.
     */
    private Integer count;

    /**
     * Internal: the previous iteration's scheduled time (ms).
     */
    private Long prevMillis;

    public String getPattern() {
        return pattern;
    }

    public void setPattern(String pattern) {
        this.pattern = pattern;
    }

    public Long getEvery() {
        return every;
    }

    public void setEvery(Long every) {
        this.every = every;
    }

    public Integer getLimit() {
        return limit;
    }

    public void setLimit(Integer limit) {
        this.limit = limit;
    }

    public Long getOffset() {
        return offset;
    }

    public void setOffset(Long offset) {
        this.offset = offset;
    }

    public Boolean getImmediately() {
        return immediately;
    }

    public void setImmediately(Boolean immediately) {
        this.immediately = immediately;
    }

    public Object getStartDate() {
        return startDate;
    }

    public void setStartDate(Object startDate) {
        this.startDate = startDate;
    }

    public Object getEndDate() {
        return endDate;
    }

    public void setEndDate(Object endDate) {
        this.endDate = endDate;
    }

    public String getTz() {
        return tz;
    }

    public void setTz(String tz) {
        this.tz = tz;
    }

    public Integer getCount() {
        return count;
    }

    public void setCount(Integer count) {
        this.count = count;
    }

    public Long getPrevMillis() {
        return prevMillis;
    }

    public void setPrevMillis(Long prevMillis) {
        this.prevMillis = prevMillis;
    }
}