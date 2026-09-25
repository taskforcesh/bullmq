package io.bullmq.core;

/**
 * Result of moving a job to a finished state (completed or failed).
 */
public class MoveToFinishedResult {
    private NextJobData next;
    private long finishedOn;

    public NextJobData getNext() {
        return next;
    }

    public void setNext(NextJobData next) {
        this.next = next;
    }

    public long getFinishedOn() {
        return finishedOn;
    }

    public void setFinishedOn(long finishedOn) {
        this.finishedOn = finishedOn;
    }
}