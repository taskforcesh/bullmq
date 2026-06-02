//! Redis key generation for BullMQ queues.
//!
//! All keys follow the pattern: `{prefix}:{queue_name}:{key_type}`.
//! The default prefix is "bull" for compatibility with Node.js BullMQ.

const DEFAULT_PREFIX: &str = "bull";

/// Holds the prefix and queue name needed to generate all Redis keys.
#[derive(Debug, Clone)]
pub struct QueueKeys {
    prefix: String,
    name: String,
}

impl QueueKeys {
    /// Create a new key context with the given prefix and queue name.
    pub fn new(name: &str, prefix: Option<&str>) -> Self {
        Self {
            prefix: prefix.unwrap_or(DEFAULT_PREFIX).to_string(),
            name: name.to_string(),
        }
    }

    /// The base key without any suffix: `{prefix}:{name}`.
    #[inline]
    pub fn base(&self) -> String {
        format!("{}:{}", self.prefix, self.name)
    }

    /// Key prefix for job keys: `{prefix}:{name}:`.
    #[inline]
    pub fn key_prefix(&self) -> String {
        format!("{}:{}:", self.prefix, self.name)
    }

    /// Build a job-specific key: `{prefix}:{name}:{job_id}`.
    #[inline]
    pub fn job_key(&self, job_id: &str) -> String {
        format!("{}:{}", self.base(), job_id)
    }

    /// Dynamic key lookup by suffix name.
    #[inline]
    pub fn get(&self, suffix: &str) -> String {
        format!("{}:{}", self.base(), suffix)
    }

    // ── Well-known keys ──────────────────────────────────────────────────

    /// The `wait` list key.
    #[inline]
    pub fn wait(&self) -> String {
        self.get("wait")
    }

    /// The `active` list key.
    #[inline]
    pub fn active(&self) -> String {
        self.get("active")
    }

    /// The `delayed` sorted-set key.
    #[inline]
    pub fn delayed(&self) -> String {
        self.get("delayed")
    }

    /// The `prioritized` sorted-set key.
    #[inline]
    pub fn prioritized(&self) -> String {
        self.get("prioritized")
    }

    /// The `completed` sorted-set key.
    #[inline]
    pub fn completed(&self) -> String {
        self.get("completed")
    }

    /// The `failed` sorted-set key.
    #[inline]
    pub fn failed(&self) -> String {
        self.get("failed")
    }

    /// The `paused` list key.
    #[inline]
    pub fn paused(&self) -> String {
        self.get("paused")
    }

    /// The `waiting-children` sorted-set key.
    #[inline]
    pub fn waiting_children(&self) -> String {
        self.get("waiting-children")
    }

    /// The `stalled` set key.
    #[inline]
    pub fn stalled(&self) -> String {
        self.get("stalled")
    }

    /// The `stalled-check` key (timestamp of last stalled check).
    #[inline]
    pub fn stalled_check(&self) -> String {
        self.get("stalled-check")
    }

    /// The `limiter` key for rate limiting.
    #[inline]
    pub fn limiter(&self) -> String {
        self.get("limiter")
    }

    /// The `events` stream key.
    #[inline]
    pub fn events(&self) -> String {
        self.get("events")
    }

    /// The `meta` hash key (queue metadata).
    #[inline]
    pub fn meta(&self) -> String {
        self.get("meta")
    }

    /// The `marker` key (signals waiting workers).
    #[inline]
    pub fn marker(&self) -> String {
        self.get("marker")
    }

    /// Priority counter key.
    #[inline]
    pub fn pc(&self) -> String {
        self.get("pc")
    }

    /// Job ID counter key.
    #[inline]
    pub fn id(&self) -> String {
        self.get("id")
    }

    /// Repeat/scheduler set key.
    #[inline]
    pub fn repeat(&self) -> String {
        self.get("repeat")
    }

    /// Queue prefix (returns the prefix value).
    #[inline]
    pub fn prefix(&self) -> &str {
        &self.prefix
    }

    /// Queue name.
    #[inline]
    pub fn name(&self) -> &str {
        &self.name
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_prefix() {
        let keys = QueueKeys::new("test-queue", None);
        assert_eq!(keys.base(), "bull:test-queue");
        assert_eq!(keys.wait(), "bull:test-queue:wait");
        assert_eq!(keys.active(), "bull:test-queue:active");
        assert_eq!(keys.meta(), "bull:test-queue:meta");
    }

    #[test]
    fn test_custom_prefix() {
        let keys = QueueKeys::new("my-queue", Some("myapp"));
        assert_eq!(keys.base(), "myapp:my-queue");
        assert_eq!(keys.delayed(), "myapp:my-queue:delayed");
    }

    #[test]
    fn test_job_key() {
        let keys = QueueKeys::new("q", None);
        assert_eq!(keys.job_key("123"), "bull:q:123");
    }
}
