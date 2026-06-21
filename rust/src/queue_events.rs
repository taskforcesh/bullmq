//! Cross-process queue event listener.
//!
//! [`QueueEvents`] consumes the Redis stream that BullMQ writes to (the
//! `{prefix}:{name}:events` key) and exposes each entry as a typed
//! [`QueueEvent`]. Unlike the in-process [`crate::worker::WorkerEvent`]
//! channel, these events are observable from any process/instance connected to
//! the same Redis server, mirroring the Node.js `QueueEvents` class.
//!
//! # Example
//!
//! ```rust,no_run
//! use bullmq::{QueueEvents, QueueEventsOptions, QueueEvent};
//!
//! # async fn example() -> bullmq::Result<()> {
//! let events = QueueEvents::new("my-queue", QueueEventsOptions::default()).await?;
//!
//! while let Some(entry) = events.next_event().await {
//!     match entry.event {
//!         QueueEvent::Completed { job_id, .. } => println!("{job_id} completed"),
//!         QueueEvent::Failed { job_id, failed_reason, .. } => {
//!             println!("{job_id} failed: {failed_reason}")
//!         }
//!         _ => {}
//!     }
//! }
//! # Ok(())
//! # }
//! ```

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use redis::streams::{StreamReadOptions, StreamReadReply};
use redis::AsyncCommands;
use tokio::sync::{mpsc, Mutex};
use tokio::task::JoinHandle;
use tracing::debug;

use crate::error::Error;
use crate::keys::{validate_queue_name, QueueKeys};
use crate::options::{QueueOptions, RedisConnectionOptions};
use crate::redis_connection::RedisConnection;

/// Options for creating a [`QueueEvents`] listener.
#[derive(Clone)]
pub struct QueueEventsOptions {
    /// Redis connection configuration.
    pub connection: RedisConnectionOptions,
    /// Key prefix for all queue keys.
    pub prefix: String,
    /// Maximum time in milliseconds to block on each `XREAD` before looping.
    ///
    /// Smaller values make [`QueueEvents::close`] more responsive at the cost of
    /// extra round trips; defaults to `5000`.
    pub blocking_timeout: u64,
    /// The stream id to start reading from.
    ///
    /// When `None`, only events produced after the listener starts are
    /// delivered (Redis `$`). Provide `Some("0")` to read the full history.
    pub last_event_id: Option<String>,
    /// Whether to start consuming events automatically on creation.
    pub autorun: bool,
}

impl Default for QueueEventsOptions {
    fn default() -> Self {
        Self {
            connection: RedisConnectionOptions::default(),
            prefix: "bull".to_string(),
            blocking_timeout: 5000,
            last_event_id: None,
            autorun: true,
        }
    }
}

/// A single entry read from the queue events stream.
#[derive(Debug, Clone)]
pub struct QueueEventEntry {
    /// The Redis stream id of this entry (e.g. `"1518945496404-0"`).
    ///
    /// Can be passed as [`QueueEventsOptions::last_event_id`] to resume.
    pub id: String,
    /// The parsed event.
    pub event: QueueEvent,
}

/// A typed queue event consumed from the events stream.
///
/// Variant names and payloads mirror the Node.js `QueueEventsListener`.
#[derive(Debug, Clone, PartialEq)]
pub enum QueueEvent {
    /// A job entered the `active` state (started processing).
    Active {
        /// The job id.
        job_id: String,
        /// The previous state, if reported.
        prev: Option<String>,
    },
    /// A job was created and added to the queue.
    Added {
        /// The job id.
        job_id: String,
        /// The job name.
        name: String,
    },
    /// Jobs were cleaned from the queue.
    Cleaned {
        /// The number of cleaned jobs (as reported by Redis, a string).
        count: String,
    },
    /// A job completed successfully.
    Completed {
        /// The job id.
        job_id: String,
        /// The raw (JSON-encoded) return value string.
        return_value: String,
        /// The previous state, if reported.
        prev: Option<String>,
    },
    /// A job was debounced (deprecated alias of [`QueueEvent::Deduplicated`]).
    Debounced {
        /// The job id.
        job_id: String,
        /// The debounce id.
        debounce_id: String,
    },
    /// A job was not added because a job with the same deduplication id exists.
    Deduplicated {
        /// The job id that was attempted.
        job_id: String,
        /// The deduplication id.
        deduplication_id: String,
        /// The id of the existing job that caused the deduplication, if any.
        deduplicated_job_id: Option<String>,
    },
    /// A job was scheduled with a delay.
    Delayed {
        /// The job id.
        job_id: String,
        /// The delay timestamp in milliseconds.
        delay: i64,
    },
    /// The waiting list became empty.
    Drained,
    /// A job with a duplicate id was rejected.
    Duplicated {
        /// The job id.
        job_id: String,
    },
    /// An error event was written to the stream (or occurred while reading).
    Error {
        /// The error message.
        message: String,
    },
    /// A job failed.
    Failed {
        /// The job id.
        job_id: String,
        /// The failure reason.
        failed_reason: String,
        /// The previous state, if reported.
        prev: Option<String>,
    },
    /// The queue was paused.
    Paused,
    /// A job reported progress.
    Progress {
        /// The job id.
        job_id: String,
        /// The progress payload (parsed JSON, or a string fallback).
        data: serde_json::Value,
    },
    /// A job was removed.
    Removed {
        /// The job id.
        job_id: String,
        /// The previous state, if reported.
        prev: Option<String>,
    },
    /// The queue was resumed.
    Resumed,
    /// A job exhausted all retry attempts.
    RetriesExhausted {
        /// The job id.
        job_id: String,
        /// The number of attempts made (as reported by Redis, a string).
        attempts_made: String,
    },
    /// A job was detected as stalled.
    Stalled {
        /// The job id.
        job_id: String,
    },
    /// A job entered the `waiting` state.
    Waiting {
        /// The job id.
        job_id: String,
        /// The previous state, if reported.
        prev: Option<String>,
    },
    /// A job entered the `waiting-children` state.
    WaitingChildren {
        /// The job id.
        job_id: String,
    },
    /// An unrecognized event (forward compatibility).
    Other {
        /// The raw `event` field value.
        event: String,
        /// All parsed fields of the stream entry.
        fields: HashMap<String, String>,
    },
}

impl QueueEvent {
    /// The job id associated with this event, if any.
    pub fn job_id(&self) -> Option<&str> {
        match self {
            QueueEvent::Active { job_id, .. }
            | QueueEvent::Added { job_id, .. }
            | QueueEvent::Completed { job_id, .. }
            | QueueEvent::Debounced { job_id, .. }
            | QueueEvent::Deduplicated { job_id, .. }
            | QueueEvent::Delayed { job_id, .. }
            | QueueEvent::Duplicated { job_id }
            | QueueEvent::Failed { job_id, .. }
            | QueueEvent::Progress { job_id, .. }
            | QueueEvent::Removed { job_id, .. }
            | QueueEvent::RetriesExhausted { job_id, .. }
            | QueueEvent::Stalled { job_id }
            | QueueEvent::Waiting { job_id, .. }
            | QueueEvent::WaitingChildren { job_id } => Some(job_id),
            _ => None,
        }
    }

    /// The event name as written to the stream (matches the Node.js event name).
    pub fn name(&self) -> &str {
        match self {
            QueueEvent::Active { .. } => "active",
            QueueEvent::Added { .. } => "added",
            QueueEvent::Cleaned { .. } => "cleaned",
            QueueEvent::Completed { .. } => "completed",
            QueueEvent::Debounced { .. } => "debounced",
            QueueEvent::Deduplicated { .. } => "deduplicated",
            QueueEvent::Delayed { .. } => "delayed",
            QueueEvent::Drained => "drained",
            QueueEvent::Duplicated { .. } => "duplicated",
            QueueEvent::Error { .. } => "error",
            QueueEvent::Failed { .. } => "failed",
            QueueEvent::Paused => "paused",
            QueueEvent::Progress { .. } => "progress",
            QueueEvent::Removed { .. } => "removed",
            QueueEvent::Resumed => "resumed",
            QueueEvent::RetriesExhausted { .. } => "retries-exhausted",
            QueueEvent::Stalled { .. } => "stalled",
            QueueEvent::Waiting { .. } => "waiting",
            QueueEvent::WaitingChildren { .. } => "waiting-children",
            QueueEvent::Other { event, .. } => event,
        }
    }
}

/// Parse a stream entry's fields into a typed [`QueueEvent`].
fn parse_event(mut fields: HashMap<String, String>) -> QueueEvent {
    let event = fields.remove("event").unwrap_or_default();
    let job_id = |f: &mut HashMap<String, String>| f.remove("jobId").unwrap_or_default();

    match event.as_str() {
        "active" => QueueEvent::Active {
            job_id: job_id(&mut fields),
            prev: fields.remove("prev"),
        },
        "added" => QueueEvent::Added {
            job_id: job_id(&mut fields),
            name: fields.remove("name").unwrap_or_default(),
        },
        "cleaned" => QueueEvent::Cleaned {
            count: fields.remove("count").unwrap_or_default(),
        },
        "completed" => QueueEvent::Completed {
            job_id: job_id(&mut fields),
            return_value: fields.remove("returnvalue").unwrap_or_default(),
            prev: fields.remove("prev"),
        },
        "debounced" => QueueEvent::Debounced {
            job_id: job_id(&mut fields),
            debounce_id: fields.remove("debounceId").unwrap_or_default(),
        },
        "deduplicated" => QueueEvent::Deduplicated {
            job_id: job_id(&mut fields),
            deduplication_id: fields.remove("deduplicationId").unwrap_or_default(),
            deduplicated_job_id: fields.remove("deduplicatedJobId"),
        },
        "delayed" => QueueEvent::Delayed {
            job_id: job_id(&mut fields),
            delay: fields
                .remove("delay")
                .and_then(|d| d.parse().ok())
                .unwrap_or(0),
        },
        "drained" => QueueEvent::Drained,
        "duplicated" => QueueEvent::Duplicated {
            job_id: job_id(&mut fields),
        },
        "error" => QueueEvent::Error {
            message: fields.remove("message").unwrap_or_default(),
        },
        "failed" => QueueEvent::Failed {
            job_id: job_id(&mut fields),
            failed_reason: fields.remove("failedReason").unwrap_or_default(),
            prev: fields.remove("prev"),
        },
        "paused" => QueueEvent::Paused,
        "progress" => {
            let raw = fields.remove("data").unwrap_or_default();
            let data = serde_json::from_str(&raw).unwrap_or(serde_json::Value::String(raw));
            QueueEvent::Progress {
                job_id: job_id(&mut fields),
                data,
            }
        }
        "removed" => QueueEvent::Removed {
            job_id: job_id(&mut fields),
            prev: fields.remove("prev"),
        },
        "resumed" => QueueEvent::Resumed,
        "retries-exhausted" => QueueEvent::RetriesExhausted {
            job_id: job_id(&mut fields),
            attempts_made: fields.remove("attemptsMade").unwrap_or_default(),
        },
        "stalled" => QueueEvent::Stalled {
            job_id: job_id(&mut fields),
        },
        "waiting" => QueueEvent::Waiting {
            job_id: job_id(&mut fields),
            prev: fields.remove("prev"),
        },
        "waiting-children" => QueueEvent::WaitingChildren {
            job_id: job_id(&mut fields),
        },
        _ => QueueEvent::Other { event, fields },
    }
}

/// Convert a stream entry's raw field map into a string map.
fn map_to_strings(map: &HashMap<String, redis::Value>) -> HashMap<String, String> {
    map.iter()
        .filter_map(|(k, v)| {
            redis::from_redis_value::<String>(v)
                .ok()
                .map(|s| (k.clone(), s))
        })
        .collect()
}

/// A cross-process, stream-based queue event listener.
///
/// See the [module documentation](crate::queue_events) for details.
pub struct QueueEvents {
    name: String,
    keys: QueueKeys,
    conn: RedisConnection,
    opts: QueueEventsOptions,
    closing: Arc<AtomicBool>,
    running: Arc<AtomicBool>,
    event_tx: Arc<Mutex<Option<mpsc::UnboundedSender<QueueEventEntry>>>>,
    event_rx: Arc<Mutex<mpsc::UnboundedReceiver<QueueEventEntry>>>,
    task: Arc<Mutex<Option<JoinHandle<()>>>>,
}

impl QueueEvents {
    /// Create a new `QueueEvents` listener with its own Redis connection.
    pub async fn new(name: &str, opts: QueueEventsOptions) -> Result<Self, Error> {
        validate_queue_name(name)?;
        let conn = RedisConnection::new(&opts.connection).await?;
        Self::build(name, conn, opts).await
    }

    /// Create a `QueueEvents` listener that reuses an existing connection.
    ///
    /// Note: the listener still opens a *dedicated* connection internally for the
    /// blocking `XREAD`; `conn` is only used for its client/configuration.
    pub async fn with_connection(
        name: &str,
        conn: RedisConnection,
        opts: QueueEventsOptions,
    ) -> Result<Self, Error> {
        validate_queue_name(name)?;
        Self::build(name, conn, opts).await
    }

    /// Convenience constructor that derives options from [`QueueOptions`].
    pub async fn from_queue_options(name: &str, opts: &QueueOptions) -> Result<Self, Error> {
        Self::new(
            name,
            QueueEventsOptions {
                connection: opts.connection.clone(),
                prefix: opts.prefix.clone(),
                ..Default::default()
            },
        )
        .await
    }

    async fn build(
        name: &str,
        conn: RedisConnection,
        opts: QueueEventsOptions,
    ) -> Result<Self, Error> {
        let keys = QueueKeys::new(name, Some(&opts.prefix));
        let (event_tx, event_rx) = mpsc::unbounded_channel();

        let events = Self {
            name: name.to_string(),
            keys,
            conn,
            opts,
            closing: Arc::new(AtomicBool::new(false)),
            running: Arc::new(AtomicBool::new(false)),
            event_tx: Arc::new(Mutex::new(Some(event_tx))),
            event_rx: Arc::new(Mutex::new(event_rx)),
            task: Arc::new(Mutex::new(None)),
        };

        if events.opts.autorun {
            events.run().await?;
        }

        Ok(events)
    }

    /// The queue name this listener observes.
    pub fn name(&self) -> &str {
        &self.name
    }

    /// The queue keys helper.
    pub fn keys(&self) -> &QueueKeys {
        &self.keys
    }

    /// Whether the consuming loop is currently running.
    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::Relaxed)
    }

    /// Start consuming events.
    ///
    /// Called automatically when [`QueueEventsOptions::autorun`] is `true`.
    /// Returns an error if the listener is already running.
    pub async fn run(&self) -> Result<(), Error> {
        if self.running.swap(true, Ordering::SeqCst) {
            return Err(Error::InvalidConfig(
                "QueueEvents is already running".to_string(),
            ));
        }

        let conn = self.conn.clone();
        let key = self.keys.events();
        let opts = self.opts.clone();
        let closing = self.closing.clone();
        let tx = self
            .event_tx
            .lock()
            .await
            .as_ref()
            .cloned()
            .ok_or_else(|| {
                Error::InvalidConfig("Cannot run QueueEvents after close()".to_string())
            })?;

        let handle = tokio::spawn(async move {
            Self::consume(conn, key, opts, closing, tx).await;
        });

        *self.task.lock().await = Some(handle);
        Ok(())
    }

    async fn consume(
        conn: RedisConnection,
        key: String,
        opts: QueueEventsOptions,
        closing: Arc<AtomicBool>,
        tx: mpsc::UnboundedSender<QueueEventEntry>,
    ) {
        let mut redis_conn = match conn.dedicated_connection().await {
            Ok(c) => c,
            Err(e) => {
                let _ = tx.send(QueueEventEntry {
                    id: String::new(),
                    event: QueueEvent::Error {
                        message: e.to_string(),
                    },
                });
                return;
            }
        };

        let mut id = opts
            .last_event_id
            .clone()
            .unwrap_or_else(|| "$".to_string());
        let read_opts = StreamReadOptions::default().block(opts.blocking_timeout as usize);

        while !closing.load(Ordering::Relaxed) {
            let reply: Result<Option<StreamReadReply>, _> =
                redis_conn.xread_options(&[&key], &[&id], &read_opts).await;

            match reply {
                Ok(Some(reply)) => {
                    for stream_key in reply.keys {
                        for entry in stream_key.ids {
                            id = entry.id.clone();
                            let fields = map_to_strings(&entry.map);
                            let event = parse_event(fields);
                            if tx
                                .send(QueueEventEntry {
                                    id: entry.id,
                                    event,
                                })
                                .is_err()
                            {
                                // Receiver dropped; stop consuming.
                                return;
                            }
                        }
                    }
                }
                Ok(None) => {
                    // Block timeout elapsed with no new events; loop again.
                }
                Err(e) => {
                    if closing.load(Ordering::Relaxed) {
                        break;
                    }
                    let _ = tx.send(QueueEventEntry {
                        id: String::new(),
                        event: QueueEvent::Error {
                            message: e.to_string(),
                        },
                    });
                    tokio::time::sleep(Duration::from_millis(100)).await;
                }
            }
        }

        debug!(queue = %key, "queue events loop stopped");
    }

    /// Wait for and return the next event, or `None` once the listener is closed
    /// and the buffer is drained.
    pub async fn next_event(&self) -> Option<QueueEventEntry> {
        let mut rx = self.event_rx.lock().await;
        rx.recv().await
    }

    /// Try to receive a buffered event without waiting.
    pub async fn try_next_event(&self) -> Option<QueueEventEntry> {
        let mut rx = self.event_rx.lock().await;
        rx.try_recv().ok()
    }

    /// Stop consuming events and release the dedicated connection.
    pub async fn close(&self) {
        self.closing.store(true, Ordering::SeqCst);
        if let Some(handle) = self.task.lock().await.take() {
            handle.abort();
        }
        self.event_tx.lock().await.take();
        self.running.store(false, Ordering::SeqCst);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fields(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    #[test]
    fn parses_completed_event() {
        let event = parse_event(fields(&[
            ("event", "completed"),
            ("jobId", "42"),
            ("returnvalue", "{\"ok\":true}"),
            ("prev", "active"),
        ]));
        assert_eq!(
            event,
            QueueEvent::Completed {
                job_id: "42".to_string(),
                return_value: "{\"ok\":true}".to_string(),
                prev: Some("active".to_string()),
            }
        );
        assert_eq!(event.job_id(), Some("42"));
        assert_eq!(event.name(), "completed");
    }

    #[test]
    fn parses_progress_json() {
        let event = parse_event(fields(&[
            ("event", "progress"),
            ("jobId", "7"),
            ("data", "{\"pct\":50}"),
        ]));
        match event {
            QueueEvent::Progress { job_id, data } => {
                assert_eq!(job_id, "7");
                assert_eq!(data, serde_json::json!({ "pct": 50 }));
            }
            other => panic!("expected progress, got {other:?}"),
        }
    }

    #[test]
    fn parses_progress_string_fallback() {
        let event = parse_event(fields(&[
            ("event", "progress"),
            ("jobId", "7"),
            ("data", "not-json"),
        ]));
        match event {
            QueueEvent::Progress { data, .. } => {
                assert_eq!(data, serde_json::Value::String("not-json".to_string()));
            }
            other => panic!("expected progress, got {other:?}"),
        }
    }

    #[test]
    fn parses_delayed_number() {
        let event = parse_event(fields(&[
            ("event", "delayed"),
            ("jobId", "1"),
            ("delay", "1700000000000"),
        ]));
        assert_eq!(
            event,
            QueueEvent::Delayed {
                job_id: "1".to_string(),
                delay: 1_700_000_000_000,
            }
        );
    }

    #[test]
    fn parses_drained() {
        let event = parse_event(fields(&[("event", "drained")]));
        assert_eq!(event, QueueEvent::Drained);
        assert_eq!(event.job_id(), None);
    }

    #[test]
    fn unknown_event_is_other() {
        let event = parse_event(fields(&[("event", "future-event"), ("jobId", "9")]));
        match event {
            QueueEvent::Other { event, fields } => {
                assert_eq!(event, "future-event");
                assert_eq!(fields.get("jobId"), Some(&"9".to_string()));
            }
            other => panic!("expected other, got {other:?}"),
        }
    }

    #[test]
    fn parses_failed_event() {
        let event = parse_event(fields(&[
            ("event", "failed"),
            ("jobId", "5"),
            ("failedReason", "boom"),
            ("prev", "active"),
        ]));
        assert_eq!(
            event,
            QueueEvent::Failed {
                job_id: "5".to_string(),
                failed_reason: "boom".to_string(),
                prev: Some("active".to_string()),
            }
        );
        assert_eq!(event.name(), "failed");
    }

    #[test]
    fn parses_active_and_waiting_with_prev() {
        let active = parse_event(fields(&[
            ("event", "active"),
            ("jobId", "1"),
            ("prev", "waiting"),
        ]));
        assert_eq!(
            active,
            QueueEvent::Active {
                job_id: "1".to_string(),
                prev: Some("waiting".to_string()),
            }
        );

        let waiting = parse_event(fields(&[("event", "waiting"), ("jobId", "2")]));
        assert_eq!(
            waiting,
            QueueEvent::Waiting {
                job_id: "2".to_string(),
                prev: None,
            }
        );
    }

    #[test]
    fn parses_added_cleaned_and_removed() {
        assert_eq!(
            parse_event(fields(&[
                ("event", "added"),
                ("jobId", "1"),
                ("name", "job")
            ])),
            QueueEvent::Added {
                job_id: "1".to_string(),
                name: "job".to_string(),
            }
        );
        assert_eq!(
            parse_event(fields(&[("event", "cleaned"), ("count", "50")])),
            QueueEvent::Cleaned {
                count: "50".to_string(),
            }
        );
        assert_eq!(
            parse_event(fields(&[
                ("event", "removed"),
                ("jobId", "3"),
                ("prev", "delayed")
            ])),
            QueueEvent::Removed {
                job_id: "3".to_string(),
                prev: Some("delayed".to_string()),
            }
        );
    }

    #[test]
    fn parses_retries_exhausted_and_waiting_children() {
        assert_eq!(
            parse_event(fields(&[
                ("event", "retries-exhausted"),
                ("jobId", "7"),
                ("attemptsMade", "3"),
            ])),
            QueueEvent::RetriesExhausted {
                job_id: "7".to_string(),
                attempts_made: "3".to_string(),
            }
        );
        let wc = parse_event(fields(&[("event", "waiting-children"), ("jobId", "8")]));
        assert_eq!(
            wc,
            QueueEvent::WaitingChildren {
                job_id: "8".to_string(),
            }
        );
        assert_eq!(wc.name(), "waiting-children");
    }

    #[test]
    fn parses_deduplicated_and_duplicated() {
        assert_eq!(
            parse_event(fields(&[
                ("event", "deduplicated"),
                ("jobId", "1"),
                ("deduplicationId", "d1"),
                ("deduplicatedJobId", "2"),
            ])),
            QueueEvent::Deduplicated {
                job_id: "1".to_string(),
                deduplication_id: "d1".to_string(),
                deduplicated_job_id: Some("2".to_string()),
            }
        );
        assert_eq!(
            parse_event(fields(&[("event", "duplicated"), ("jobId", "9")])),
            QueueEvent::Duplicated {
                job_id: "9".to_string(),
            }
        );
    }

    #[test]
    fn parses_paused_resumed_and_error() {
        assert_eq!(
            parse_event(fields(&[("event", "paused")])),
            QueueEvent::Paused
        );
        assert_eq!(
            parse_event(fields(&[("event", "resumed")])),
            QueueEvent::Resumed
        );
        assert_eq!(
            parse_event(fields(&[("event", "error"), ("message", "bad")])),
            QueueEvent::Error {
                message: "bad".to_string(),
            }
        );
    }

    #[test]
    fn job_id_and_name_helpers_are_consistent() {
        // Events without a job id return None.
        assert_eq!(QueueEvent::Drained.job_id(), None);
        assert_eq!(QueueEvent::Paused.job_id(), None);
        assert_eq!(QueueEvent::Resumed.job_id(), None);
        assert_eq!(
            QueueEvent::Cleaned {
                count: "1".to_string()
            }
            .job_id(),
            None
        );
        // name() round-trips through parse_event for every known variant.
        for ev in [
            "active",
            "added",
            "cleaned",
            "completed",
            "debounced",
            "deduplicated",
            "delayed",
            "drained",
            "duplicated",
            "error",
            "failed",
            "paused",
            "progress",
            "removed",
            "resumed",
            "retries-exhausted",
            "stalled",
            "waiting",
            "waiting-children",
        ] {
            assert_eq!(parse_event(fields(&[("event", ev)])).name(), ev);
        }
    }
}
