package io.bullmq.core.options;

/**
 * Policy for keeping completed/failed jobs.
 */
public class KeepJobs {
    /**
     * Maximum number of jobs to keep.
     */
    private Integer count;

    /**
     * Maximum age in seconds of jobs to keep.
     */
    private Integer age;

    public Integer getCount() {
        return count;
    }

    public void setCount(Integer count) {
        this.count = count;
    }

    public Integer getAge() {
        return age;
    }

    public void setAge(Integer age) {
        this.age = age;
    }
}