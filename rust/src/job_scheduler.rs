//! Job Scheduler — repeatable/cron-based job scheduling.
//!
//! Provides the ability to schedule jobs that repeat on a cron pattern or at
//! fixed intervals. Schedulers are persisted in Redis and survive restarts.

use crate::error::Error;
use crate::options::JobOptions;
use chrono::{TimeZone, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Options for configuring a job scheduler's repeat behavior.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepeatOptions {
    /// Cron pattern (e.g., `"*/5 * * * * *"` for every 5 seconds).
    /// Mutually exclusive with `every`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pattern: Option<String>,

    /// Repeat every N milliseconds. Mutually exclusive with `pattern`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub every: Option<u64>,

    /// Maximum number of iterations before stopping.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<u64>,

    /// Whether to run the first iteration immediately (cron only).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub immediately: Option<bool>,

    /// Offset in milliseconds to adjust next iteration time.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset: Option<u64>,

    /// Start date (Unix timestamp in ms). First execution won't happen before this.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_date: Option<u64>,

    /// End date (Unix timestamp in ms). No executions after this.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_date: Option<u64>,

    /// IANA timezone string (e.g., `"America/New_York"`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tz: Option<String>,

    /// Current iteration count (internal).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub count: Option<u64>,
}

/// JSON representation of a job scheduler (returned by get methods).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobSchedulerJson {
    /// The scheduler ID.
    pub key: String,
    /// The job name.
    pub name: String,
    /// Current iteration count.
    #[serde(default)]
    pub iteration_count: u64,
    /// Maximum iterations limit.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<u64>,
    /// Start date (Unix ms).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_date: Option<u64>,
    /// End date (Unix ms).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_date: Option<u64>,
    /// Timezone.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tz: Option<String>,
    /// Cron pattern.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pattern: Option<String>,
    /// Repeat every (ms).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub every: Option<u64>,
    /// Next execution time (Unix ms).
    #[serde(default)]
    pub next: Option<u64>,
    /// Offset in ms.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset: Option<u64>,
    /// Template data.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
    /// Template options.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub opts: Option<serde_json::Value>,
}

/// Compute the next execution time for a cron pattern.
///
/// Returns the next millisecond timestamp after `now_ms`.
pub fn next_cron_millis(
    pattern: &str,
    now_ms: u64,
    tz: Option<&str>,
    start_date: Option<u64>,
) -> Result<Option<u64>, Error> {
    use croner::parser::{CronParser, Seconds};

    let cron = CronParser::builder()
        .seconds(Seconds::Optional)
        .build()
        .parse(pattern)
        .map_err(|e| Error::InvalidConfig(format!("invalid cron pattern '{}': {}", pattern, e)))?;

    // Determine the reference time
    let reference_ms = match start_date {
        Some(sd) if sd > now_ms => sd,
        _ => now_ms,
    };

    let next = if let Some(tz_str) = tz {
        let tz: chrono_tz::Tz = tz_str
            .parse()
            .map_err(|_| Error::InvalidConfig(format!("invalid timezone: {}", tz_str)))?;
        let dt = tz
            .timestamp_millis_opt(reference_ms as i64)
            .single()
            .ok_or_else(|| {
                Error::InvalidConfig("ambiguous or invalid timestamp for timezone".to_string())
            })?;
        cron.find_next_occurrence(&dt, false)
            .map_err(|e| Error::InvalidConfig(format!("cron iteration error: {}", e)))?
            .timestamp_millis() as u64
    } else {
        let dt = Utc
            .timestamp_millis_opt(reference_ms as i64)
            .single()
            .ok_or_else(|| Error::InvalidConfig("invalid timestamp".to_string()))?;
        cron.find_next_occurrence(&dt, false)
            .map_err(|e| Error::InvalidConfig(format!("cron iteration error: {}", e)))?
            .timestamp_millis() as u64
    };

    Ok(Some(next))
}

/// Internal: Pack scheduler options into msgpack for the Lua script.
pub(crate) fn pack_scheduler_opts(name: &str, repeat_opts: &RepeatOptions) -> Vec<u8> {
    use rmp::encode::*;

    let mut entries: Vec<(&str, Vec<u8>)> = Vec::new();

    // name (always present)
    {
        let mut b = Vec::new();
        write_str(&mut b, name).unwrap();
        entries.push(("name", b));
    }

    if let Some(ref tz) = repeat_opts.tz {
        let mut b = Vec::new();
        write_str(&mut b, tz).unwrap();
        entries.push(("tz", b));
    }

    if let Some(ref pattern) = repeat_opts.pattern {
        let mut b = Vec::new();
        write_str(&mut b, pattern).unwrap();
        entries.push(("pattern", b));
    }

    if let Some(every) = repeat_opts.every {
        let mut b = Vec::new();
        write_uint(&mut b, every).unwrap();
        entries.push(("every", b));
    }

    if let Some(limit) = repeat_opts.limit {
        let mut b = Vec::new();
        write_uint(&mut b, limit).unwrap();
        entries.push(("limit", b));
    }

    if let Some(offset) = repeat_opts.offset {
        let mut b = Vec::new();
        write_uint(&mut b, offset).unwrap();
        entries.push(("offset", b));
    }

    if let Some(start_date) = repeat_opts.start_date {
        let mut b = Vec::new();
        write_uint(&mut b, start_date).unwrap();
        entries.push(("startDate", b));
    }

    if let Some(end_date) = repeat_opts.end_date {
        let mut b = Vec::new();
        write_uint(&mut b, end_date).unwrap();
        entries.push(("endDate", b));
    }

    // Encode as msgpack map
    let mut buf = Vec::with_capacity(128);
    write_map_len(&mut buf, entries.len() as u32).unwrap();
    for (key, val) in &entries {
        write_str(&mut buf, key).unwrap();
        buf.extend_from_slice(val);
    }

    buf
}

/// Internal: Pack job options into msgpack for delayed job creation.
pub(crate) fn pack_delayed_job_opts(
    job_opts: &JobOptions,
    job_scheduler_id: &str,
    next_millis: u64,
    iteration_count: u64,
    offset: Option<u64>,
    repeat_opts: &RepeatOptions,
) -> Vec<u8> {
    use rmp::encode::*;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64;

    let effective_offset = offset.unwrap_or(0);
    let delay = (next_millis + effective_offset).saturating_sub(now);

    let job_id = format!("repeat:{}:{}", job_scheduler_id, next_millis);

    let mut entries: Vec<(&str, Vec<u8>)> = Vec::new();

    // delay
    {
        let mut b = Vec::new();
        write_uint(&mut b, delay).unwrap();
        entries.push(("delay", b));
    }

    // timestamp
    {
        let mut b = Vec::new();
        write_uint(&mut b, now).unwrap();
        entries.push(("timestamp", b));
    }

    // jobId
    {
        let mut b = Vec::new();
        write_str(&mut b, &job_id).unwrap();
        entries.push(("jobId", b));
    }

    // repeatJobKey
    {
        let mut b = Vec::new();
        write_str(&mut b, job_scheduler_id).unwrap();
        entries.push(("repeatJobKey", b));
    }

    // repeat options — include ALL fields so they propagate across iterations
    {
        let mut repeat_buf = Vec::new();
        let mut repeat_entries: Vec<(&str, Vec<u8>)> = Vec::new();

        // count (current iteration)
        {
            let mut b = Vec::new();
            write_uint(&mut b, iteration_count).unwrap();
            repeat_entries.push(("count", b));
        }

        if effective_offset > 0 {
            let mut b = Vec::new();
            write_uint(&mut b, effective_offset).unwrap();
            repeat_entries.push(("offset", b));
        }

        // every
        if let Some(every) = repeat_opts.every {
            let mut b = Vec::new();
            write_uint(&mut b, every).unwrap();
            repeat_entries.push(("every", b));
        }

        // pattern
        if let Some(ref pattern) = repeat_opts.pattern {
            let mut b = Vec::new();
            write_str(&mut b, pattern).unwrap();
            repeat_entries.push(("pattern", b));
        }

        // limit
        if let Some(limit) = repeat_opts.limit {
            let mut b = Vec::new();
            write_uint(&mut b, limit).unwrap();
            repeat_entries.push(("limit", b));
        }

        // tz
        if let Some(ref tz) = repeat_opts.tz {
            let mut b = Vec::new();
            write_str(&mut b, tz).unwrap();
            repeat_entries.push(("tz", b));
        }

        // startDate
        if let Some(start_date) = repeat_opts.start_date {
            let mut b = Vec::new();
            write_uint(&mut b, start_date).unwrap();
            repeat_entries.push(("startDate", b));
        }

        // endDate
        if let Some(end_date) = repeat_opts.end_date {
            let mut b = Vec::new();
            write_uint(&mut b, end_date).unwrap();
            repeat_entries.push(("endDate", b));
        }

        write_map_len(&mut repeat_buf, repeat_entries.len() as u32).unwrap();
        for (key, val) in &repeat_entries {
            write_str(&mut repeat_buf, key).unwrap();
            repeat_buf.extend_from_slice(val);
        }

        entries.push(("repeat", repeat_buf));
    }

    // attempts
    if let Some(attempts) = job_opts.attempts {
        let mut b = Vec::new();
        write_uint(&mut b, attempts as u64).unwrap();
        entries.push(("attempts", b));
    }

    // backoff
    if let Some(ref backoff) = job_opts.backoff {
        let b = crate::queue::Queue::encode_backoff(backoff);
        entries.push(("backoff", b));
    }

    // removeOnComplete
    if let Some(ref roc) = job_opts.remove_on_complete {
        let b = crate::queue::Queue::encode_remove_on_finish(roc);
        entries.push(("removeOnComplete", b));
    }

    // removeOnFail
    if let Some(ref rof) = job_opts.remove_on_fail {
        let b = crate::queue::Queue::encode_remove_on_finish(rof);
        entries.push(("removeOnFail", b));
    }

    // priority
    if let Some(priority) = job_opts.priority {
        if priority > 0 {
            let mut b = Vec::new();
            write_uint(&mut b, priority as u64).unwrap();
            entries.push(("priority", b));
        }
    }

    // Encode as msgpack map
    let mut buf = Vec::with_capacity(128);
    write_map_len(&mut buf, entries.len() as u32).unwrap();
    for (key, val) in &entries {
        write_str(&mut buf, key).unwrap();
        buf.extend_from_slice(val);
    }

    buf
}

/// Parse the result from the getJobScheduler Lua script.
pub(crate) fn parse_scheduler_hash(
    id: &str,
    fields: &HashMap<String, String>,
    next_millis: Option<u64>,
) -> JobSchedulerJson {
    JobSchedulerJson {
        key: id.to_string(),
        name: fields.get("name").cloned().unwrap_or_default(),
        iteration_count: fields.get("ic").and_then(|v| v.parse().ok()).unwrap_or(0),
        limit: fields.get("limit").and_then(|v| v.parse().ok()),
        start_date: fields.get("startDate").and_then(|v| v.parse().ok()),
        end_date: fields.get("endDate").and_then(|v| v.parse().ok()),
        tz: fields.get("tz").cloned(),
        pattern: fields.get("pattern").cloned(),
        every: fields.get("every").and_then(|v| v.parse().ok()),
        next: next_millis,
        offset: fields.get("offset").and_then(|v| v.parse().ok()),
        data: fields
            .get("data")
            .and_then(|d| serde_json::from_str(d).ok()),
        opts: fields
            .get("opts")
            .and_then(|o| serde_json::from_str(o).ok()),
    }
}
