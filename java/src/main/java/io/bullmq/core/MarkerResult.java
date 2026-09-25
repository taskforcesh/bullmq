package io.bullmq.core;

/**
 * Result of waiting for a job (worker blocking primitive).
 */
public class MarkerResult {
    private final String member;
    private final double score;

    public MarkerResult(String member, double score) {
        this.member = member;
        this.score = score;
    }

    public String getMember() {
        return member;
    }

    public double getScore() {
        return score;
    }
}