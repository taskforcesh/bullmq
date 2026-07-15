//! Redis key generation for BullMQ queues.
//!
//! All keys follow the pattern: `{prefix}:{queue_name}:{key_type}`.
//! The default prefix is "bull" for compatibility with Node.js BullMQ.

use crate::error::Error;

const DEFAULT_PREFIX: &str = "bull";

/// Validate a queue name using the same separator restriction as BullMQ Node.js.
pub(crate) fn validate_queue_name(name: &str) -> Result<(), Error> {
    if name.is_empty() {
        return Err(Error::InvalidConfig(
            "Queue name must be provided".to_string(),
        ));
    }
    if name.contains(':') {
        return Err(Error::InvalidConfig(
            "Queue name cannot contain :".to_string(),
        ));
    }
    Ok(())
}

/// Resolve `ParentOpts.queue` into a qualified queue key.
///
/// Accepts either an unqualified queue name (`queue`) or a pre-qualified key
/// using the current prefix (`prefix:queue`). The queue-name portion is always
/// validated so malformed values like `foo:bar` are rejected unless they are a
/// valid `{prefix}:{queueName}` pair for the current prefix.
pub(crate) fn resolve_parent_queue_key(prefix: &str, queue: &str) -> Result<String, Error> {
    let qualified_prefix = format!("{prefix}:");
    if let Some(queue_name) = queue.strip_prefix(&qualified_prefix) {
        validate_queue_name(queue_name)?;
        return Ok(queue.to_string());
    }

    validate_queue_name(queue)?;
    Ok(format!("{prefix}:{queue}"))
}

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

    /// The Redis client connection name format used by workers.
    ///
    /// Matches the Node.js format `{prefix}:{base64(queueName)}{suffix}` so that
    /// `Queue::get_workers` can discover clients across implementations.
    #[inline]
    pub fn client_name(&self, suffix: &str) -> String {
        format!("{}:{}{}", self.prefix, base64_standard(&self.name), suffix)
    }
}

/// Encode bytes as standard (RFC 4648) base64 with padding.
///
/// Mirrors Node.js `Buffer.from(s).toString('base64')`, which BullMQ uses to
/// build Redis client connection names.
fn base64_standard(input: &str) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let bytes = input.as_bytes();
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);

    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let triple = (b0 << 16) | (b1 << 8) | b2;

        out.push(ALPHABET[((triple >> 18) & 0x3F) as usize] as char);
        out.push(ALPHABET[((triple >> 12) & 0x3F) as usize] as char);
        if chunk.len() > 1 {
            out.push(ALPHABET[((triple >> 6) & 0x3F) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(ALPHABET[(triple & 0x3F) as usize] as char);
        } else {
            out.push('=');
        }
    }

    out
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
    fn test_base64_standard_matches_node() {
        // Equivalent to Node `Buffer.from(s).toString('base64')`.
        assert_eq!(base64_standard("test"), "dGVzdA==");
        assert_eq!(base64_standard("my-queue"), "bXktcXVldWU=");
        assert_eq!(base64_standard("f"), "Zg==");
        assert_eq!(base64_standard("fo"), "Zm8=");
        assert_eq!(base64_standard("foo"), "Zm9v");
        assert_eq!(base64_standard(""), "");
    }

    #[test]
    fn test_client_name() {
        let keys = QueueKeys::new("test", Some("bull"));
        assert_eq!(keys.client_name(""), "bull:dGVzdA==");
        assert_eq!(keys.client_name(":w:worker-1"), "bull:dGVzdA==:w:worker-1");
    }

    #[test]
    fn test_job_key() {
        let keys = QueueKeys::new("q", None);
        assert_eq!(keys.job_key("123"), "bull:q:123");
    }

    #[test]
    fn resolves_unqualified_parent_queue_names() {
        assert_eq!(
            resolve_parent_queue_key("bull", "parent-queue").unwrap(),
            "bull:parent-queue"
        );
    }

    #[test]
    fn accepts_prequalified_parent_queue_keys_for_current_prefix() {
        assert_eq!(
            resolve_parent_queue_key("bull", "bull:parent-queue").unwrap(),
            "bull:parent-queue"
        );
    }

    #[test]
    fn rejects_parent_queue_names_with_extra_colons() {
        let err = resolve_parent_queue_key("bull", "parent:queue").unwrap_err();
        assert!(matches!(err, Error::InvalidConfig(_)));

        let err = resolve_parent_queue_key("bull", "bull:parent:queue").unwrap_err();
        assert!(matches!(err, Error::InvalidConfig(_)));
    }
}
