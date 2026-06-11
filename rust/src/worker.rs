use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tokio::sync::{broadcast, mpsc, Mutex, Notify, RwLock};
use tokio::task::JoinHandle;
use tracing::{debug, error, warn};
use uuid::Uuid;

use crate::error::Error;
use crate::job::Job;
use crate::keys::QueueKeys;
use crate::options::{JobOptions, WorkerOptions};
use crate::redis_connection::{BlockingRedisConnection, RedisConnection};
use crate::types::RemoveOnFinish;

/// Type alias for the processor function.
///
/// The processor receives a reference to the job and a cancellation token,
/// and returns a future that resolves to either the return value or an error.
pub type ProcessorFn = Arc<
    dyn Fn(
            Job,
            CancellationToken,
        ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, Error>> + Send>>
        + Send
        + Sync,
>;

/// A token that signals whether a job has been cancelled.
#[derive(Debug, Clone)]
pub struct CancellationToken {
    cancelled: Arc<AtomicBool>,
    notify: Arc<Notify>,
}

impl CancellationToken {
    /// Create a new active (non-cancelled) token.
    pub fn new() -> Self {
        Self {
            cancelled: Arc::new(AtomicBool::new(false)),
            notify: Arc::new(Notify::new()),
        }
    }

    /// Check if cancellation has been requested.
    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Relaxed)
    }

    /// Cancel the token, notifying all waiters.
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
        self.notify.notify_waiters();
    }

    /// Wait until cancellation is requested.
    pub async fn cancelled(&self) {
        let notified = self.notify.notified();
        tokio::pin!(notified);
        notified.as_mut().enable();

        if self.is_cancelled() {
            return;
        }

        notified.await;
    }
}

impl Default for CancellationToken {
    fn default() -> Self {
        Self::new()
    }
}

/// Events emitted by the Worker.
#[derive(Debug, Clone)]
pub enum WorkerEvent {
    /// A job has been completed successfully.
    Completed {
        /// The job ID.
        job_id: String,
        /// The return value from the processor.
        result: serde_json::Value,
    },
    /// A job has failed.
    Failed {
        /// The job ID.
        job_id: String,
        /// The error message.
        error: String,
    },
    /// An error occurred in the worker.
    Error(String),
    /// The worker has become idle (no jobs to process).
    Drained,
    /// The worker is ready to process jobs.
    Ready,
    /// The worker has been closed.
    Closed,
    /// A stalled job was detected.
    Stalled {
        /// The stalled job ID.
        job_id: String,
    },
    /// A job has started processing.
    Active {
        /// The job ID that became active.
        job_id: String,
    },
    /// Job progress was updated.
    Progress {
        /// The job ID.
        job_id: String,
        /// The updated progress value.
        progress: crate::types::JobProgress,
    },
    /// The worker was paused.
    Paused,
    /// The worker was resumed.
    Resumed,
}

/// A Worker processes jobs from a queue.
///
/// The worker fetches jobs, manages locks, handles retries and stalled job detection.
///
/// # Example
///
/// ```rust,no_run
/// use bullmq::{Worker, WorkerOptions, Job};
/// use std::sync::Arc;
///
/// # async fn example() -> bullmq::Result<()> {
/// let worker = Worker::new(
///     "my-queue",
///     Arc::new(|job: Job, _token| Box::pin(async move {
///         println!("Processing: {}", job.name());
///         Ok(serde_json::Value::Null)
///     })),
///     WorkerOptions::default(),
/// ).await?;
/// # Ok(())
/// # }
/// ```
pub struct Worker {
    keys: QueueKeys,
    opts: WorkerOptions,
    id: String,
    conn: RedisConnection,
    blocking_conn: BlockingRedisConnection,
    processor: ProcessorFn,
    running: Arc<AtomicBool>,
    paused: Arc<AtomicBool>,
    closing: Arc<AtomicBool>,
    event_tx: mpsc::UnboundedSender<WorkerEvent>,
    event_rx: Arc<Mutex<mpsc::UnboundedReceiver<WorkerEvent>>>,
    active_jobs: Arc<RwLock<Vec<ActiveJob>>>,
    main_loop_handle: Mutex<Option<JoinHandle<()>>>,
    stalled_check_handle: Mutex<Option<JoinHandle<()>>>,
    lock_renew_handle: Mutex<Option<JoinHandle<()>>>,
    progress_tx: broadcast::Sender<crate::job::JobProgressEvent>,
    /// Dynamic concurrency: the desired number of concurrent workers.
    desired_concurrency: Arc<AtomicUsize>,
    /// Dynamic concurrency: gate for workers waiting for a slot.
    concurrency_gate: Arc<Notify>,
    /// Dynamic concurrency: count of workers currently in the fetch-process phase.
    active_fetchers: Arc<AtomicUsize>,
}

/// Tracks an active job being processed.
struct ActiveJob {
    job_id: String,
    token: String,
    cancel_token: CancellationToken,
}

/// Result from a moveToActive attempt.
enum FetchResult {
    /// A job is ready for processing.
    Job(Box<Job>),
    /// No job ready, but there's a delayed job at this timestamp (ms).
    NextTimestamp(u64),
    /// Queue is completely empty (no waiting or delayed jobs).
    Empty,
    /// Rate limited — the value is the TTL in ms until the limit expires.
    RateLimited(u64),
}

/// Shared context for all worker loops within a single Worker instance.
///
/// Pre-computes keys and holds all shared state needed by the processing loops,
/// avoiding excessive cloning and keeping the loop body focused on logic.
struct LoopContext {
    conn: RedisConnection,
    keys: QueueKeys,
    opts: WorkerOptions,
    processor: ProcessorFn,
    progress_tx: broadcast::Sender<crate::job::JobProgressEvent>,
    paused: Arc<AtomicBool>,
    closing: Arc<AtomicBool>,
    active_jobs: Arc<RwLock<Vec<ActiveJob>>>,
    event_tx: mpsc::UnboundedSender<WorkerEvent>,
    desired_concurrency: Arc<AtomicUsize>,
    concurrency_gate: Arc<Notify>,
    active_fetchers: Arc<AtomicUsize>,

    // Pre-computed keys (avoid re-generating on every call)
    move_to_active_keys: Vec<String>,
    move_to_finished_base_keys: Vec<String>,
    completed_key: String,
    failed_key: String,
    metrics_completed_key: String,
    metrics_failed_key: String,
    marker_key: String,
    prefix_bytes: Vec<u8>,

    // Token generation
    worker_id: String,
    token_counter: std::sync::atomic::AtomicU64,
}

impl LoopContext {
    #[allow(clippy::too_many_arguments)]
    fn new(
        conn: RedisConnection,
        keys: QueueKeys,
        opts: WorkerOptions,
        worker_id: String,
        processor: ProcessorFn,
        progress_tx: broadcast::Sender<crate::job::JobProgressEvent>,
        paused: Arc<AtomicBool>,
        closing: Arc<AtomicBool>,
        active_jobs: Arc<RwLock<Vec<ActiveJob>>>,
        event_tx: mpsc::UnboundedSender<WorkerEvent>,
        desired_concurrency: Arc<AtomicUsize>,
        concurrency_gate: Arc<Notify>,
        active_fetchers: Arc<AtomicUsize>,
    ) -> Self {
        let move_to_active_keys = vec![
            keys.wait(),
            keys.active(),
            keys.prioritized(),
            keys.events(),
            keys.stalled(),
            keys.limiter(),
            keys.delayed(),
            keys.paused(),
            keys.meta(),
            keys.pc(),
            keys.marker(),
        ];
        let move_to_finished_base_keys = vec![
            keys.wait(),
            keys.active(),
            keys.prioritized(),
            keys.events(),
            keys.stalled(),
            keys.limiter(),
            keys.delayed(),
            keys.paused(),
            keys.meta(),
            keys.pc(),
        ];
        let completed_key = keys.completed();
        let failed_key = keys.failed();
        let metrics_completed_key = keys.get("metrics:completed");
        let metrics_failed_key = keys.get("metrics:failed");
        let marker_key = keys.marker();
        let prefix_bytes = keys.key_prefix().into_bytes();

        Self {
            conn,
            keys,
            opts,
            processor,
            progress_tx,
            paused,
            closing,
            active_jobs,
            event_tx,
            desired_concurrency,
            concurrency_gate,
            active_fetchers,
            move_to_active_keys,
            move_to_finished_base_keys,
            completed_key,
            failed_key,
            metrics_completed_key,
            metrics_failed_key,
            marker_key,
            prefix_bytes,
            worker_id,
            token_counter: std::sync::atomic::AtomicU64::new(0),
        }
    }

    /// Generate a unique token for a job fetch.
    fn next_token(&self) -> String {
        let seq = self.token_counter.fetch_add(1, Ordering::Relaxed);
        format!("{}:{}", self.worker_id, seq)
    }
}

fn pack_move_to_active_opts(token: &str, opts: &WorkerOptions) -> Vec<u8> {
    use rmp::encode::*;

    let mut len = 2;
    if opts.name.is_some() {
        len += 1;
    }
    if opts.limiter.is_some() {
        len += 1;
    }

    let mut buf = Vec::with_capacity(96);
    write_map_len(&mut buf, len).unwrap();
    write_str(&mut buf, "token").unwrap();
    write_str(&mut buf, token).unwrap();
    write_str(&mut buf, "lockDuration").unwrap();
    write_uint(&mut buf, opts.lock_duration).unwrap();

    if let Some(name) = opts.name.as_deref() {
        write_str(&mut buf, "name").unwrap();
        write_str(&mut buf, name).unwrap();
    }

    if let Some(ref limiter) = opts.limiter {
        write_str(&mut buf, "limiter").unwrap();
        // Encode limiter as a sub-map {max, duration}
        write_map_len(&mut buf, 2).unwrap();
        write_str(&mut buf, "max").unwrap();
        write_uint(&mut buf, limiter.max).unwrap();
        write_str(&mut buf, "duration").unwrap();
        write_uint(&mut buf, limiter.duration).unwrap();
    }

    buf
}

/// Map a negative status code returned by `moveToFinished` / `moveToCompleted`
/// to a descriptive error, mirroring Node.js `Scripts.finishedErrors`.
///
/// `command` is the name of the Lua command (e.g. "moveToFinished") and `state`
/// is the previous job state (used for the not-in-state / lock-mismatch cases).
fn finished_error(code: i64, job_id: &str, command: &str, state: &str) -> Error {
    match code {
        -1 => Error::ProcessingError(format!("Missing key for job {}. {}", job_id, command)),
        -2 => Error::ProcessingError(format!("Missing lock for job {}. {}", job_id, command)),
        -3 => Error::ProcessingError(format!(
            "Job {} is not in the {} state. {}",
            job_id, state, command
        )),
        -4 => Error::ProcessingError(format!(
            "Job {} has pending dependencies. {}",
            job_id, command
        )),
        -6 => Error::ProcessingError(format!(
            "Lock mismatch for job {}. Cmd {} from {}",
            job_id, command, state
        )),
        -9 => Error::Unrecoverable(format!(
            "Cannot complete job {} because it has at least one failed child. {}",
            job_id, command
        )),
        _ => Error::from_script_code(code),
    }
}

fn pack_move_to_finished_opts(
    token: &str,
    opts: &WorkerOptions,
    job_opts: &JobOptions,
    attempts: u32,
    target: &str,
) -> Vec<u8> {
    use rmp::encode::*;

    let mut len = 9;
    if opts.name.is_some() {
        len += 1;
    }

    let mut buf = Vec::with_capacity(160);
    write_map_len(&mut buf, len).unwrap();

    write_str(&mut buf, "token").unwrap();
    write_str(&mut buf, token).unwrap();

    write_str(&mut buf, "keepJobs").unwrap();
    // Job-level options take priority over worker-level options
    let keep_policy = if target == "completed" {
        job_opts
            .remove_on_complete
            .as_ref()
            .or(opts.remove_on_complete.as_ref())
    } else {
        job_opts
            .remove_on_fail
            .as_ref()
            .or(opts.remove_on_fail.as_ref())
    };
    write_keep_jobs(&mut buf, keep_policy);

    write_str(&mut buf, "lockDuration").unwrap();
    write_uint(&mut buf, opts.lock_duration).unwrap();

    write_str(&mut buf, "attempts").unwrap();
    write_uint(&mut buf, attempts as u64).unwrap();

    write_str(&mut buf, "maxMetricsSize").unwrap();
    // When metrics are enabled, this is the max number of data points to keep.
    // An empty string disables metrics collection in the Lua script.
    match opts.metrics.as_ref() {
        Some(m) => write_str(&mut buf, &m.max_data_points.to_string()).unwrap(),
        None => write_str(&mut buf, "").unwrap(),
    }

    for key in ["fpof", "cpof", "idof", "rdof"] {
        write_str(&mut buf, key).unwrap();
        write_bool(&mut buf, false).unwrap();
    }

    if let Some(name) = opts.name.as_deref() {
        write_str(&mut buf, "name").unwrap();
        write_str(&mut buf, name).unwrap();
    }

    buf
}

fn write_keep_jobs(buf: &mut Vec<u8>, policy: Option<&RemoveOnFinish>) {
    use rmp::encode::*;

    match policy {
        Some(RemoveOnFinish::Bool(true)) => {
            write_map_len(buf, 1).unwrap();
            write_str(buf, "count").unwrap();
            write_sint(buf, 0).unwrap();
        }
        Some(RemoveOnFinish::Bool(false)) | None => {
            write_map_len(buf, 1).unwrap();
            write_str(buf, "count").unwrap();
            write_sint(buf, -1).unwrap();
        }
        Some(RemoveOnFinish::Count(count)) => {
            write_map_len(buf, 1).unwrap();
            write_str(buf, "count").unwrap();
            write_uint(buf, *count as u64).unwrap();
        }
        Some(RemoveOnFinish::Options(keep_jobs)) => {
            let len = keep_jobs.age.is_some() as u32 + keep_jobs.count.is_some() as u32;
            write_map_len(buf, len).unwrap();
            if let Some(age) = keep_jobs.age {
                write_str(buf, "age").unwrap();
                write_uint(buf, age).unwrap();
            }
            if let Some(count) = keep_jobs.count {
                write_str(buf, "count").unwrap();
                write_uint(buf, count as u64).unwrap();
            }
        }
    }
}

impl Worker {
    /// Create a new Worker and start processing jobs.
    pub async fn new(
        queue_name: &str,
        processor: ProcessorFn,
        opts: WorkerOptions,
    ) -> Result<Self, Error> {
        // Validate options
        if opts.concurrency == 0 {
            return Err(Error::InvalidConfig(
                "concurrency must be a finite number greater than 0".to_string(),
            ));
        }
        if opts.stalled_interval == 0 {
            return Err(Error::InvalidConfig(
                "stalledInterval must be greater than 0".to_string(),
            ));
        }
        if opts.drain_delay == 0 {
            return Err(Error::InvalidConfig(
                "drainDelay must be greater than 0".to_string(),
            ));
        }

        let conn = RedisConnection::new(&opts.connection).await?;
        let blocking_conn = BlockingRedisConnection::new(conn.client()).await?;
        let keys = QueueKeys::new(queue_name, Some(&opts.prefix));
        let id = Uuid::new_v4().to_string();
        let (event_tx, event_rx) = mpsc::unbounded_channel();
        let (progress_tx, _) = broadcast::channel(128);

        let worker = Self {
            keys,
            opts: opts.clone(),
            id,
            conn,
            blocking_conn,
            processor,
            running: Arc::new(AtomicBool::new(false)),
            paused: Arc::new(AtomicBool::new(false)),
            closing: Arc::new(AtomicBool::new(false)),
            event_tx,
            event_rx: Arc::new(Mutex::new(event_rx)),
            active_jobs: Arc::new(RwLock::new(Vec::new())),
            main_loop_handle: Mutex::new(None),
            stalled_check_handle: Mutex::new(None),
            lock_renew_handle: Mutex::new(None),
            progress_tx,
            desired_concurrency: Arc::new(AtomicUsize::new(opts.concurrency)),
            concurrency_gate: Arc::new(Notify::new()),
            active_fetchers: Arc::new(AtomicUsize::new(0)),
        };

        if opts.autorun {
            worker.run().await?;
        }

        Ok(worker)
    }

    /// The worker's unique ID.
    pub fn id(&self) -> &str {
        &self.id
    }

    /// The worker's concurrency setting.
    pub fn concurrency(&self) -> usize {
        self.desired_concurrency.load(Ordering::Relaxed)
    }

    /// Dynamically change the worker's concurrency.
    ///
    /// Updates the target number of concurrent fetchers for running worker loops.
    /// Existing loops are woken to re-check the concurrency gate.
    pub fn set_concurrency(&self, concurrency: usize) {
        if concurrency == 0 {
            return;
        }
        let old = self.desired_concurrency.swap(concurrency, Ordering::SeqCst);
        if concurrency > old {
            // Wake up any workers waiting at the gate
            self.concurrency_gate.notify_waiters();
        }
    }

    /// Whether the worker is currently running.
    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::Relaxed)
    }

    /// Whether the worker is paused.
    pub fn is_paused(&self) -> bool {
        self.paused.load(Ordering::Relaxed)
    }

    /// Number of currently active jobs.
    pub async fn active_count(&self) -> usize {
        self.active_jobs.read().await.len()
    }

    /// Receive the next worker event.
    pub async fn next_event(&self) -> Option<WorkerEvent> {
        self.event_rx.lock().await.recv().await
    }

    /// Start processing jobs.
    pub async fn run(&self) -> Result<(), Error> {
        if self.running.load(Ordering::Relaxed) {
            return Err(Error::InvalidConfig(
                "Worker is already running".to_string(),
            ));
        }

        self.running.store(true, Ordering::Release);
        let _ = self.event_tx.send(WorkerEvent::Ready);

        self.start_progress_forwarder().await;
        self.start_stalled_check().await;
        self.start_lock_renewal().await;
        self.start_main_loop().await;

        Ok(())
    }

    /// Pause the worker (finish active jobs but don't fetch new ones).
    pub fn pause(&self) {
        self.paused.store(true, Ordering::Release);
        let _ = self.event_tx.send(WorkerEvent::Paused);
    }

    /// Resume the worker.
    pub fn resume(&self) {
        self.paused.store(false, Ordering::Release);
        let _ = self.event_tx.send(WorkerEvent::Resumed);
    }

    /// Cancel a specific active job.
    pub async fn cancel_job(&self, job_id: &str) -> bool {
        let jobs = self.active_jobs.read().await;
        if let Some(active) = jobs.iter().find(|j| j.job_id == job_id) {
            active.cancel_token.cancel();
            true
        } else {
            false
        }
    }

    /// Cancel all active jobs.
    pub async fn cancel_all_jobs(&self) {
        let jobs = self.active_jobs.read().await;
        for active in jobs.iter() {
            active.cancel_token.cancel();
        }
    }

    /// Close the worker gracefully.
    ///
    /// Waits for active jobs to complete (up to `timeout` milliseconds).
    pub async fn close(&self, timeout_ms: u64) -> Result<(), Error> {
        self.closing.store(true, Ordering::Release);
        self.running.store(false, Ordering::Release);
        // Wake any workers waiting at the concurrency gate so they can exit
        self.concurrency_gate.notify_waiters();

        // Wait for active jobs to drain
        let deadline = tokio::time::Instant::now() + Duration::from_millis(timeout_ms);
        loop {
            if self.active_jobs.read().await.is_empty() {
                break;
            }
            if tokio::time::Instant::now() >= deadline {
                warn!("close timeout reached with active jobs remaining");
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }

        // Cancel background tasks
        if let Some(handle) = self.main_loop_handle.lock().await.take() {
            handle.abort();
        }
        if let Some(handle) = self.stalled_check_handle.lock().await.take() {
            handle.abort();
        }
        if let Some(handle) = self.lock_renew_handle.lock().await.take() {
            handle.abort();
        }

        let _ = self.event_tx.send(WorkerEvent::Closed);
        self.conn.close().await;

        debug!("worker closed");
        Ok(())
    }

    /// Manually fetch the next job (blocking — waits for a job to become available).
    pub async fn get_next_job(&self, token: &str) -> Result<Option<Job>, Error> {
        if self.paused.load(Ordering::Acquire) {
            return Ok(None);
        }
        let mut job = self.fetch_next_job(token, true).await?;
        if let Some(ref mut j) = job {
            j.set_context(crate::job::ScriptContext {
                conn: self.conn.clone(),
                keys: self.keys.clone(),
                progress_tx: self.progress_tx.clone(),
                token: token.to_string(),
                lock_duration: self.opts.lock_duration,
            });
            let _ = self.event_tx.send(WorkerEvent::Active {
                job_id: j.id().to_string(),
            });
        }
        Ok(job)
    }

    /// Manually fetch the next job (non-blocking — returns None immediately if no job available).
    pub async fn get_next_job_nonblocking(&self, token: &str) -> Result<Option<Job>, Error> {
        if self.paused.load(Ordering::Acquire) {
            return Ok(None);
        }
        let mut job = self.fetch_next_job(token, false).await?;
        if let Some(ref mut j) = job {
            j.set_context(crate::job::ScriptContext {
                conn: self.conn.clone(),
                keys: self.keys.clone(),
                progress_tx: self.progress_tx.clone(),
                token: token.to_string(),
                lock_duration: self.opts.lock_duration,
            });
            let _ = self.event_tx.send(WorkerEvent::Active {
                job_id: j.id().to_string(),
            });
        }
        Ok(job)
    }

    // ── Private: Main Loop ───────────────────────────────────────────────

    async fn start_main_loop(&self) {
        let ctx = Arc::new(LoopContext::new(
            self.conn.clone(),
            self.keys.clone(),
            self.opts.clone(),
            self.id.clone(),
            self.processor.clone(),
            self.progress_tx.clone(),
            self.paused.clone(),
            self.closing.clone(),
            self.active_jobs.clone(),
            self.event_tx.clone(),
            self.desired_concurrency.clone(),
            self.concurrency_gate.clone(),
            self.active_fetchers.clone(),
        ));

        let blocking_conn = self.blocking_conn.clone();
        let concurrency = self.opts.concurrency;
        let job_available = Arc::new(Notify::new());

        let handle = tokio::spawn(async move {
            let mut worker_handles = Vec::with_capacity(concurrency + 1);

            // Spawn N worker loops — each independently fetches and processes
            for _ in 0..concurrency {
                let ctx = ctx.clone();
                let job_available = job_available.clone();
                worker_handles.push(tokio::spawn(Self::run_worker_loop(ctx, job_available)));
            }

            // Blocking watcher: waits on BZPOPMIN and wakes idle workers
            {
                let closing = ctx.closing.clone();
                let drain_delay = ctx.opts.drain_delay;
                let marker_key = ctx.keys.marker();
                let job_available = job_available.clone();
                worker_handles.push(tokio::spawn(Self::run_blocking_watcher(
                    closing,
                    blocking_conn,
                    marker_key,
                    drain_delay,
                    job_available,
                )));
            }

            for h in worker_handles {
                let _ = h.await;
            }
        });

        *self.main_loop_handle.lock().await = Some(handle);
    }

    /// A single worker's fetch-process loop. Runs until `closing` is set.
    async fn run_worker_loop(ctx: Arc<LoopContext>, job_available: Arc<Notify>) {
        loop {
            if ctx.closing.load(Ordering::Relaxed) {
                break;
            }

            if ctx.paused.load(Ordering::Relaxed) {
                tokio::time::sleep(Duration::from_millis(100)).await;
                continue;
            }

            // Wait for a concurrency slot
            if !Self::acquire_concurrency_slot(&ctx).await {
                break; // closing
            }

            let token = ctx.next_token();

            // Try to fetch a job (non-blocking — script only)
            let fetch_result = Self::try_fetch_job_fast(
                &ctx.conn,
                &ctx.move_to_active_keys,
                &ctx.prefix_bytes,
                &token,
                &ctx.opts,
            )
            .await;

            match fetch_result {
                Ok(FetchResult::Job(job)) => {
                    Self::process_fetched_job(&ctx, *job, &token).await;
                    Self::release_concurrency_slot(&ctx);
                }
                Ok(FetchResult::NextTimestamp(next_ts)) => {
                    // No job ready, but there's a delayed job coming
                    Self::release_concurrency_slot(&ctx);
                    let now = SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .unwrap()
                        .as_millis() as u64;
                    if next_ts > now {
                        // Cap the sleep to periodically re-check `closing`.
                        let delay_ms = (next_ts - now).min(5_000);
                        // Wait for either the delay or a notification
                        tokio::select! {
                            _ = tokio::time::sleep(Duration::from_millis(delay_ms)) => {}
                            _ = job_available.notified() => {}
                        }
                    }
                    continue;
                }
                Ok(FetchResult::RateLimited(ttl_ms)) => {
                    // Rate limited — wait for the TTL to expire (capped by maximumRateLimitDelay)
                    Self::release_concurrency_slot(&ctx);
                    let delay = ttl_ms.min(ctx.opts.maximum_rate_limit_delay);
                    tokio::select! {
                        _ = tokio::time::sleep(Duration::from_millis(delay)) => {}
                        _ = job_available.notified() => {}
                    }
                    continue;
                }
                Ok(FetchResult::Empty) => {
                    Self::release_concurrency_slot(&ctx);
                    let _ = ctx.event_tx.send(WorkerEvent::Drained);
                    // Use select to allow periodic re-check of `closing` flag
                    tokio::select! {
                        _ = job_available.notified() => {}
                        _ = tokio::time::sleep(Duration::from_millis(5_000)) => {}
                    }
                    continue;
                }
                Err(e) => {
                    Self::release_concurrency_slot(&ctx);
                    let _ = ctx.event_tx.send(WorkerEvent::Error(e.to_string()));
                    tokio::time::sleep(Duration::from_millis(ctx.opts.run_retry_delay)).await;
                    continue;
                }
            };
        }
    }

    /// Wait until a concurrency slot is available. Returns false if closing.
    async fn acquire_concurrency_slot(ctx: &LoopContext) -> bool {
        loop {
            if ctx.closing.load(Ordering::Relaxed) {
                return false;
            }
            let desired = ctx.desired_concurrency.load(Ordering::Relaxed);
            let current = ctx.active_fetchers.load(Ordering::Relaxed);
            if current < desired {
                if ctx
                    .active_fetchers
                    .compare_exchange_weak(
                        current,
                        current + 1,
                        Ordering::SeqCst,
                        Ordering::Relaxed,
                    )
                    .is_ok()
                {
                    return true;
                }
            } else {
                ctx.concurrency_gate.notified().await;
            }
        }
    }

    /// Release a concurrency slot and notify waiters.
    fn release_concurrency_slot(ctx: &LoopContext) {
        ctx.active_fetchers.fetch_sub(1, Ordering::SeqCst);
        ctx.concurrency_gate.notify_one();
    }

    /// Process a job that was successfully fetched from the queue.
    async fn process_fetched_job(ctx: &LoopContext, mut job: Job, token: &str) {
        let cancel_token = CancellationToken::new();
        let job_id = job.id().to_string();
        let job_attempts = job.opts().attempts.unwrap_or(0);
        let job_attempts_made = job.attempts_made();
        let job_opts = job.opts().clone();
        let job_data = job.data().clone();
        let repeat_job_key = job.repeat_job_key().map(|s| s.to_string());
        let job_name = job.name().to_string();

        // Attach script context so job can call update_progress, etc.
        job.set_context(crate::job::ScriptContext {
            conn: ctx.conn.clone(),
            keys: ctx.keys.clone(),
            progress_tx: ctx.progress_tx.clone(),
            token: token.to_string(),
            lock_duration: ctx.opts.lock_duration,
        });

        // Register as active
        {
            let mut jobs = ctx.active_jobs.write().await;
            jobs.push(ActiveJob {
                job_id: job_id.clone(),
                token: token.to_string(),
                cancel_token: cancel_token.clone(),
            });
        }

        let _ = ctx.event_tx.send(WorkerEvent::Active {
            job_id: job_id.clone(),
        });

        // Check for deferred failure (fpof: parent failed because child failed)
        if let Some(deferred_reason) = job.deferred_failure() {
            let err = Error::Unrecoverable(deferred_reason.to_string());
            Self::handle_job_failed(
                ctx,
                &job_id,
                token,
                err,
                job_attempts,
                job_attempts_made,
                &job_opts,
                &job_data,
            )
            .await;
            // Remove from active jobs before returning early, otherwise close()
            // would wait for this job to drain until its timeout elapses.
            {
                let mut jobs = ctx.active_jobs.write().await;
                jobs.retain(|j| j.job_id != job_id);
            }
            return;
        }

        // Run the processor
        let discarded = job.discarded_handle();
        let result = (ctx.processor.clone())(job, cancel_token).await;

        match result {
            Ok(return_value) => {
                Self::handle_job_completed(
                    ctx,
                    &job_id,
                    token,
                    &return_value,
                    job_attempts,
                    job_attempts_made,
                    &job_opts,
                    &job_data,
                )
                .await;

                // Schedule the next iteration if this is a repeatable job
                if let Some(ref scheduler_id) = repeat_job_key {
                    if let Err(e) = Self::update_job_scheduler(
                        ctx,
                        scheduler_id,
                        &job_id,
                        &job_name,
                        &job_data,
                        &job_opts,
                    )
                    .await
                    {
                        error!(
                            job_id = %job_id,
                            scheduler_id = %scheduler_id,
                            error = %e,
                            "failed to schedule next iteration"
                        );
                        let _ = ctx.event_tx.send(WorkerEvent::Error(format!(
                            "Failed to add repeatable job for next iteration: {}",
                            e
                        )));
                    }
                }
            }
            Err(e) => {
                // If the processor called `job.discard()`, treat the failure as
                // unrecoverable so the job is not retried (mirrors Node.js).
                let e = if discarded.load(Ordering::SeqCst) && !matches!(e, Error::Unrecoverable(_))
                {
                    Error::Unrecoverable(e.to_string())
                } else {
                    e
                };
                Self::handle_job_failed(
                    ctx,
                    &job_id,
                    token,
                    e,
                    job_attempts,
                    job_attempts_made,
                    &job_opts,
                    &job_data,
                )
                .await;

                // Schedule the next iteration even when job fails
                if let Some(ref scheduler_id) = repeat_job_key {
                    if let Err(e) = Self::update_job_scheduler(
                        ctx,
                        scheduler_id,
                        &job_id,
                        &job_name,
                        &job_data,
                        &job_opts,
                    )
                    .await
                    {
                        error!(
                            job_id = %job_id,
                            scheduler_id = %scheduler_id,
                            error = %e,
                            "failed to schedule next iteration after job failure"
                        );
                        let _ = ctx.event_tx.send(WorkerEvent::Error(format!(
                            "Failed to add repeatable job for next iteration: {}",
                            e
                        )));
                    }
                }
            }
        }

        // Remove from active jobs
        {
            let mut jobs = ctx.active_jobs.write().await;
            jobs.retain(|j| j.job_id != job_id);
        }
    }

    /// Handle a successfully completed job.
    #[allow(clippy::too_many_arguments)]
    async fn handle_job_completed(
        ctx: &LoopContext,
        job_id: &str,
        token: &str,
        return_value: &serde_json::Value,
        job_attempts: u32,
        job_attempts_made: u32,
        job_opts: &JobOptions,
        job_data: &serde_json::Value,
    ) {
        if let Err(e) = Self::move_to_finished_fast(
            &ctx.conn,
            &ctx.move_to_finished_base_keys,
            &ctx.prefix_bytes,
            &ctx.keys,
            job_id,
            token,
            return_value,
            job_attempts,
            &ctx.opts,
            job_opts,
            "completed",
            &ctx.completed_key,
            &ctx.metrics_completed_key,
            &ctx.marker_key,
        )
        .await
        {
            // A negative status code from moveToFinished means the job could not be
            // completed (e.g. it still has pending or failed children). Mirror the
            // Node.js behaviour: turn the script code into a descriptive error and
            // move the job to the failed state.
            if let Error::Script { code, .. } = e {
                let mapped = finished_error(code, job_id, "moveToFinished", "active");
                Self::handle_job_failed(
                    ctx,
                    job_id,
                    token,
                    mapped,
                    job_attempts,
                    job_attempts_made,
                    job_opts,
                    job_data,
                )
                .await;
                return;
            }

            error!(job_id = %job_id, error = %e, "failed to move job to completed");
            let _ = ctx.event_tx.send(WorkerEvent::Error(e.to_string()));
        } else {
            let _ = ctx.event_tx.send(WorkerEvent::Completed {
                job_id: job_id.to_string(),
                result: return_value.clone(),
            });
        }
    }

    /// Schedule the next iteration of a repeatable job by calling the
    /// `updateJobScheduler` Lua script. This is the critical path that
    /// keeps job schedulers running — must never silently swallow errors.
    async fn update_job_scheduler(
        ctx: &LoopContext,
        scheduler_id: &str,
        job_id: &str,
        _job_name: &str,
        job_data: &serde_json::Value,
        job_opts: &JobOptions,
    ) -> Result<(), Error> {
        use crate::job_scheduler::next_cron_millis;
        use std::time::{SystemTime, UNIX_EPOCH};

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        // Check limit: if we have repeat options with a limit, enforce it
        if let Some(ref repeat) = job_opts.repeat {
            if let Some(limit) = repeat.limit {
                let next_count = repeat.count.map(|c| c + 1).unwrap_or(1);
                if next_count > limit {
                    return Ok(()); // Limit reached, don't schedule next
                }
            }

            // Check end date
            if let Some(end_date) = repeat.end_date {
                if now > end_date {
                    return Ok(()); // Past end date, don't schedule next
                }
            }
        }

        // Compute nextMillis for cron patterns (for `every`, the Lua script handles it)
        let next_millis: u64 = if let Some(ref repeat) = job_opts.repeat {
            if let Some(ref pattern) = repeat.pattern {
                // Use prevMillis as reference if available, otherwise now
                let reference = job_opts.prev_millis.unwrap_or(now);
                let reference = if reference < now { now } else { reference };

                match next_cron_millis(pattern, reference, repeat.tz.as_deref(), repeat.start_date)
                {
                    Ok(Some(ms)) => {
                        if ms < now {
                            now
                        } else {
                            ms
                        }
                    }
                    Ok(None) => return Ok(()), // No next occurrence
                    Err(e) => {
                        return Err(Error::InvalidConfig(format!(
                            "cron computation failed for scheduler '{}': {}",
                            scheduler_id, e
                        )));
                    }
                }
            } else {
                // For `every`-based schedulers, pass 0; the Lua script recomputes
                0
            }
        } else {
            // No repeat options on the job — the Lua script reads from the scheduler hash
            0
        };

        // Build the msgpacked opts for the Lua script
        let opts_packed = Self::pack_update_scheduler_opts(job_opts);

        // Template data
        let template_data = serde_json::to_string(job_data).unwrap_or_else(|_| "{}".to_string());

        let script = ctx
            .conn
            .scripts()
            .get("updateJobScheduler")
            .ok_or_else(|| Error::InvalidConfig("updateJobScheduler script not found".to_string()))?
            .clone();

        // Build keys (12 keys)
        let repeat_key = ctx.keys.repeat();
        let delayed_key = ctx.keys.delayed();
        let wait_key = ctx.keys.wait();
        let paused_key = ctx.keys.paused();
        let meta_key = ctx.keys.meta();
        let prioritized_key = ctx.keys.prioritized();
        let marker_key = ctx.keys.marker();
        let id_key = ctx.keys.id();
        let events_key = ctx.keys.events();
        let pc_key = ctx.keys.pc();
        let producer_key = ctx.keys.job_key(job_id);
        let active_key = ctx.keys.active();

        let script_keys: Vec<&str> = vec![
            &repeat_key,
            &delayed_key,
            &wait_key,
            &paused_key,
            &meta_key,
            &prioritized_key,
            &marker_key,
            &id_key,
            &events_key,
            &pc_key,
            &producer_key,
            &active_key,
        ];

        // Build args (7 args)
        let next_millis_str = next_millis.to_string();
        let now_str = now.to_string();
        let prefix = ctx.keys.key_prefix();

        let args: Vec<&[u8]> = vec![
            next_millis_str.as_bytes(), // ARGV[1] nextMillis
            scheduler_id.as_bytes(),    // ARGV[2] jobSchedulerId
            template_data.as_bytes(),   // ARGV[3] template data (JSON)
            &opts_packed,               // ARGV[4] msgpacked opts
            now_str.as_bytes(),         // ARGV[5] timestamp
            prefix.as_bytes(),          // ARGV[6] prefix key
            job_id.as_bytes(),          // ARGV[7] producerId
        ];

        let mut redis_conn = ctx.conn.conn();
        let _result = script.execute(&mut redis_conn, &script_keys, &args).await?;

        // Script returns the next job ID on success, or nil if scheduler
        // was removed/doesn't exist. Both are valid outcomes.
        Ok(())
    }

    /// Pack job options into msgpack format for the updateJobScheduler script.
    fn pack_update_scheduler_opts(job_opts: &JobOptions) -> Vec<u8> {
        use rmp::encode::*;

        let mut entries: Vec<(&str, Vec<u8>)> = Vec::new();

        // repeat sub-map — include ALL fields so they propagate to the next job
        if let Some(ref repeat) = job_opts.repeat {
            let mut repeat_entries: Vec<(&str, Vec<u8>)> = Vec::new();

            if let Some(every) = repeat.every {
                let mut b = Vec::new();
                write_uint(&mut b, every).unwrap();
                repeat_entries.push(("every", b));
            }

            if let Some(ref pattern) = repeat.pattern {
                let mut b = Vec::new();
                write_str(&mut b, pattern).unwrap();
                repeat_entries.push(("pattern", b));
            }

            if let Some(offset) = repeat.offset {
                let mut b = Vec::new();
                write_uint(&mut b, offset).unwrap();
                repeat_entries.push(("offset", b));
            }

            // Increment count for the next iteration
            let next_count = repeat.count.map(|c| c + 1).unwrap_or(1);
            {
                let mut b = Vec::new();
                write_uint(&mut b, next_count).unwrap();
                repeat_entries.push(("count", b));
            }

            if let Some(limit) = repeat.limit {
                let mut b = Vec::new();
                write_uint(&mut b, limit).unwrap();
                repeat_entries.push(("limit", b));
            }

            if let Some(ref tz) = repeat.tz {
                let mut b = Vec::new();
                write_str(&mut b, tz).unwrap();
                repeat_entries.push(("tz", b));
            }

            if let Some(start_date) = repeat.start_date {
                let mut b = Vec::new();
                write_uint(&mut b, start_date).unwrap();
                repeat_entries.push(("startDate", b));
            }

            if let Some(end_date) = repeat.end_date {
                let mut b = Vec::new();
                write_uint(&mut b, end_date).unwrap();
                repeat_entries.push(("endDate", b));
            }

            let mut repeat_buf = Vec::new();
            write_map_len(&mut repeat_buf, repeat_entries.len() as u32).unwrap();
            for (key, val) in &repeat_entries {
                write_str(&mut repeat_buf, key).unwrap();
                repeat_buf.extend_from_slice(val);
            }

            entries.push(("repeat", repeat_buf));
        } else {
            // Empty repeat map - script may still need it
            let mut repeat_buf = Vec::new();
            write_map_len(&mut repeat_buf, 0).unwrap();
            entries.push(("repeat", repeat_buf));
        }

        // repeatJobKey
        if let Some(ref rjk) = job_opts.repeat_job_key {
            let mut b = Vec::new();
            write_str(&mut b, rjk).unwrap();
            entries.push(("repeatJobKey", b));
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

    /// Handle a failed job — retry or move to permanent failure.
    #[allow(clippy::too_many_arguments)]
    async fn handle_job_failed(
        ctx: &LoopContext,
        job_id: &str,
        token: &str,
        error: Error,
        job_attempts: u32,
        job_attempts_made: u32,
        job_opts: &JobOptions,
        job_data: &serde_json::Value,
    ) {
        // DelayedError / WaitingChildren: job was already moved by the processor
        if matches!(error, Error::Delayed | Error::WaitingChildren) {
            return;
        }

        // RateLimited: the processor called `queue.rate_limit(..)` and signalled a
        // rate-limit. Move the job back from active to wait/prioritized instead of
        // failing it. When it is re-fetched it will respect the rate-limit TTL.
        if matches!(error, Error::RateLimited { .. }) {
            if let Err(e) = Self::move_job_from_active_to_wait(ctx, job_id, token).await {
                error!(job_id = %job_id, error = %e, "failed to move rate-limited job back to wait");
                let _ = ctx.event_tx.send(WorkerEvent::Error(e.to_string()));
            }
            return;
        }

        let is_unrecoverable = matches!(error, Error::Unrecoverable(_));
        let should_retry =
            !is_unrecoverable && job_attempts > 0 && (job_attempts_made + 1) < job_attempts;

        if should_retry {
            Self::handle_retry(
                ctx,
                job_id,
                token,
                &error,
                job_attempts,
                job_attempts_made,
                job_opts,
                job_data,
            )
            .await;
        } else {
            Self::move_to_permanent_failure(ctx, job_id, token, &error, job_attempts, job_opts)
                .await;
        }
    }

    /// Attempt to retry a failed job (with or without backoff).
    #[allow(clippy::too_many_arguments)]
    async fn handle_retry(
        ctx: &LoopContext,
        job_id: &str,
        token: &str,
        error: &Error,
        job_attempts: u32,
        job_attempts_made: u32,
        job_opts: &JobOptions,
        job_data: &serde_json::Value,
    ) {
        let retry_result = if let Some(ref backoff) = job_opts.backoff {
            let delay = Self::calculate_backoff(
                backoff,
                job_attempts_made + 1,
                &error.to_string(),
                job_data,
                ctx.opts.backoff_strategy.as_ref(),
            )
            .await;

            if delay == -1 {
                // Custom backoff says don't retry — move to failed
                Self::move_to_permanent_failure(ctx, job_id, token, error, job_attempts, job_opts)
                    .await;
                return;
            } else if delay > 0 {
                Self::move_to_delayed_for_retry(
                    &ctx.conn,
                    &ctx.keys,
                    job_id,
                    token,
                    &ctx.prefix_bytes,
                    delay as u64,
                    &ctx.opts,
                )
                .await
            } else {
                Self::retry_job_immediately(&ctx.conn, &ctx.keys, job_id, token, &ctx.prefix_bytes)
                    .await
            }
        } else {
            Self::retry_job_immediately(&ctx.conn, &ctx.keys, job_id, token, &ctx.prefix_bytes)
                .await
        };

        if let Err(retry_err) = retry_result {
            error!(job_id = %job_id, error = %retry_err, "failed to retry job");
            let _ = ctx.event_tx.send(WorkerEvent::Error(retry_err.to_string()));
        }

        // Emit Failed event for each attempt (matches Node.js behavior)
        let _ = ctx.event_tx.send(WorkerEvent::Failed {
            job_id: job_id.to_string(),
            error: error.to_string(),
        });
    }

    /// Move a job to permanent failure state.
    async fn move_to_permanent_failure(
        ctx: &LoopContext,
        job_id: &str,
        token: &str,
        error: &Error,
        job_attempts: u32,
        job_opts: &JobOptions,
    ) {
        let error_value = serde_json::Value::String(error.to_string());
        if let Err(move_err) = Self::move_to_finished_fast(
            &ctx.conn,
            &ctx.move_to_finished_base_keys,
            &ctx.prefix_bytes,
            &ctx.keys,
            job_id,
            token,
            &error_value,
            job_attempts,
            &ctx.opts,
            job_opts,
            "failed",
            &ctx.failed_key,
            &ctx.metrics_failed_key,
            &ctx.marker_key,
        )
        .await
        {
            error!(job_id = %job_id, error = %move_err, "failed to move job to failed");
            let _ = ctx.event_tx.send(WorkerEvent::Error(move_err.to_string()));
        }
        let _ = ctx.event_tx.send(WorkerEvent::Failed {
            job_id: job_id.to_string(),
            error: error.to_string(),
        });
    }

    /// Move a job from the active list back to wait (or prioritized, if it has a
    /// priority). Used when a processor signals a rate-limit via
    /// [`Error::RateLimited`].
    async fn move_job_from_active_to_wait(
        ctx: &LoopContext,
        job_id: &str,
        token: &str,
    ) -> Result<(), Error> {
        let script = ctx
            .conn
            .scripts()
            .get("moveJobFromActiveToWait")
            .ok_or_else(|| {
                Error::InvalidConfig("moveJobFromActiveToWait script not found".to_string())
            })?
            .clone();

        let keys = &ctx.keys;
        let job_key = keys.job_key(job_id);
        let script_keys: Vec<String> = vec![
            keys.active(),
            keys.wait(),
            keys.stalled(),
            keys.paused(),
            keys.meta(),
            keys.limiter(),
            keys.prioritized(),
            keys.marker(),
            keys.events(),
        ];

        let args: Vec<&[u8]> = vec![job_id.as_bytes(), token.as_bytes(), job_key.as_bytes()];

        let mut conn = ctx.conn.conn();
        let _: redis::Value = script.execute(&mut conn, &script_keys, &args).await?;
        Ok(())
    }

    /// Blocking watcher loop — uses BZPOPMIN to detect new/delayed jobs.
    async fn run_blocking_watcher(
        closing: Arc<AtomicBool>,
        blocking_conn: BlockingRedisConnection,
        marker_key: String,
        drain_delay: u64,
        job_available: Arc<Notify>,
    ) {
        loop {
            if closing.load(Ordering::Relaxed) {
                break;
            }

            match blocking_conn
                .bzpopmin(&marker_key, drain_delay as f64)
                .await
            {
                Ok(Some(_)) => {
                    job_available.notify_waiters();
                }
                Ok(None) => {
                    job_available.notify_waiters();
                }
                Err(_) => {
                    if closing.load(Ordering::Relaxed) {
                        break;
                    }
                    tokio::time::sleep(Duration::from_millis(100)).await;
                }
            }
        }
    }

    /// Try to fetch a job using the moveToActive script only (non-blocking).
    /// Fast version of try_fetch_job that uses pre-computed keys and prefix.
    async fn try_fetch_job_fast(
        conn: &RedisConnection,
        script_keys: &[String],
        prefix_bytes: &[u8],
        token: &str,
        opts: &WorkerOptions,
    ) -> Result<FetchResult, Error> {
        let script = conn
            .scripts()
            .get("moveToActive")
            .ok_or_else(|| Error::InvalidConfig("moveToActive script not found".to_string()))?
            .clone();

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        let opts_packed = pack_move_to_active_opts(token, opts);
        let now_bytes = now.to_string().into_bytes();
        let args: Vec<&[u8]> = vec![prefix_bytes, &now_bytes, &opts_packed];

        let mut redis_conn = conn.conn();
        let result = script.execute(&mut redis_conn, script_keys, &args).await?;

        Self::parse_move_to_active_result(&result)
    }

    /// Fast version of move_to_completed/failed using pre-computed base keys.
    #[allow(clippy::too_many_arguments)]
    async fn move_to_finished_fast(
        conn: &RedisConnection,
        base_keys: &[String],
        prefix_bytes: &[u8],
        keys: &QueueKeys,
        job_id: &str,
        token: &str,
        value: &serde_json::Value,
        attempts: u32,
        opts: &WorkerOptions,
        job_opts: &JobOptions,
        target: &str,
        target_set_key: &str,
        metrics_key: &str,
        marker_key: &str,
    ) -> Result<(), Error> {
        let script = conn
            .scripts()
            .get("moveToFinished")
            .ok_or_else(|| Error::InvalidConfig("moveToFinished script not found".to_string()))?
            .clone();

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        let value_str = serde_json::to_string(value).unwrap_or_default();

        // For failedReason, store the raw string (not JSON-encoded).
        // For returnvalue, store the JSON-encoded value.
        let failed_reason_str: String;
        let field_value_str: &str = if target == "failed" {
            failed_reason_str = value.as_str().unwrap_or_default().to_string();
            &failed_reason_str
        } else {
            &value_str
        };

        // Build full keys: base_keys[0..10] + target set + job key + metrics key + marker
        let job_key = keys.job_key(job_id);

        let mut script_keys: Vec<&str> = Vec::with_capacity(14);
        for k in base_keys.iter() {
            script_keys.push(k);
        }
        script_keys.push(target_set_key);
        script_keys.push(&job_key);
        script_keys.push(metrics_key);
        script_keys.push(marker_key);

        let (field_name, field_value): (&[u8], &[u8]) = if target == "completed" {
            (b"returnvalue", field_value_str.as_bytes())
        } else {
            (b"failedReason", field_value_str.as_bytes())
        };

        let job_id_bytes = job_id.as_bytes();
        let now_bytes = now.to_string().into_bytes();
        let opts_packed = pack_move_to_finished_opts(token, opts, job_opts, attempts, target);
        let fields_to_update: Vec<u8> = Vec::new();
        let args: Vec<&[u8]> = vec![
            job_id_bytes,
            &now_bytes,
            field_name,
            field_value,
            target.as_bytes(),
            b"0",
            prefix_bytes,
            &opts_packed,
            &fields_to_update,
        ];

        let mut redis_conn = conn.conn();
        let result = script.execute(&mut redis_conn, &script_keys, &args).await?;

        match result {
            redis::Value::Int(code) if code < 0 => Err(Error::from_script_code(code)),
            _ => Ok(()),
        }
    }

    /// Retry a failed job by moving it back to the wait queue (no backoff).
    async fn retry_job_immediately(
        conn: &RedisConnection,
        keys: &QueueKeys,
        job_id: &str,
        token: &str,
        prefix: &[u8],
    ) -> Result<(), Error> {
        let script = conn
            .scripts()
            .get("retryJob")
            .ok_or_else(|| Error::InvalidConfig("retryJob script not found".to_string()))?
            .clone();

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        let job_key = keys.job_key(job_id);
        let active = keys.active();
        let wait = keys.wait();
        let paused = keys.paused();
        let meta = keys.meta();
        let events = keys.events();
        let delayed = keys.delayed();
        let prioritized = keys.prioritized();
        let pc = keys.pc();
        let marker = keys.marker();
        let stalled = keys.stalled();

        let script_keys: Vec<&str> = vec![
            &active,      // KEYS[1]
            &wait,        // KEYS[2]
            &paused,      // KEYS[3]
            &job_key,     // KEYS[4]
            &meta,        // KEYS[5]
            &events,      // KEYS[6]
            &delayed,     // KEYS[7]
            &prioritized, // KEYS[8]
            &pc,          // KEYS[9]
            &marker,      // KEYS[10]
            &stalled,     // KEYS[11]
        ];

        let prefix_str = std::str::from_utf8(prefix).unwrap_or("");
        let now_str = now.to_string();
        let push_cmd = b"LPUSH";
        let fields_to_update: Vec<u8> = Vec::new();

        let args: Vec<&[u8]> = vec![
            prefix_str.as_bytes(), // ARGV[1] key prefix
            now_str.as_bytes(),    // ARGV[2] timestamp
            push_cmd,              // ARGV[3] pushCmd
            job_id.as_bytes(),     // ARGV[4] jobId
            token.as_bytes(),      // ARGV[5] token
            &fields_to_update,     // ARGV[6] optional fields
        ];

        let mut redis_conn = conn.conn();
        let result = script.execute(&mut redis_conn, &script_keys, &args).await?;

        match result {
            redis::Value::Int(code) if code < 0 => Err(Error::from_script_code(code)),
            _ => Ok(()),
        }
    }

    /// Move a failed job to delayed queue for retry with backoff.
    async fn move_to_delayed_for_retry(
        conn: &RedisConnection,
        keys: &QueueKeys,
        job_id: &str,
        token: &str,
        prefix: &[u8],
        delay: u64,
        opts: &WorkerOptions,
    ) -> Result<(), Error> {
        let script = conn
            .scripts()
            .get("moveToDelayed")
            .ok_or_else(|| Error::InvalidConfig("moveToDelayed script not found".to_string()))?
            .clone();

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        let job_key = keys.job_key(job_id);
        let marker = keys.marker();
        let active = keys.active();
        let prioritized = keys.prioritized();
        let delayed = keys.delayed();
        let events = keys.events();
        let meta = keys.meta();
        let stalled = keys.stalled();
        let wait = keys.wait();
        let limiter = keys.limiter();
        let paused = keys.paused();
        let pc = keys.pc();

        let script_keys: Vec<&str> = vec![
            &marker,      // KEYS[1]
            &active,      // KEYS[2]
            &prioritized, // KEYS[3]
            &delayed,     // KEYS[4]
            &job_key,     // KEYS[5]
            &events,      // KEYS[6]
            &meta,        // KEYS[7]
            &stalled,     // KEYS[8]
            &wait,        // KEYS[9]
            &limiter,     // KEYS[10]
            &paused,      // KEYS[11]
            &pc,          // KEYS[12]
        ];

        let prefix_str = std::str::from_utf8(prefix).unwrap_or("");
        let now_str = now.to_string();
        let delay_str = delay.to_string();
        let skip_attempt = b"0"; // Don't skip attempt increment
        let fields_to_update: Vec<u8> = Vec::new();
        let fetch_next = b"0"; // Don't fetch next

        // Pack opts for fetchNextJob (even though we're not fetching, script expects it)
        let move_opts =
            pack_move_to_finished_opts(token, opts, &JobOptions::default(), 0, "failed");

        let args: Vec<&[u8]> = vec![
            prefix_str.as_bytes(), // ARGV[1] key prefix
            now_str.as_bytes(),    // ARGV[2] timestamp
            job_id.as_bytes(),     // ARGV[3] jobId
            token.as_bytes(),      // ARGV[4] queue token
            delay_str.as_bytes(),  // ARGV[5] delay value
            skip_attempt,          // ARGV[6] skip attempt
            &fields_to_update,     // ARGV[7] fields to update
            fetch_next,            // ARGV[8] fetch next?
            &move_opts,            // ARGV[9] opts
        ];

        let mut redis_conn = conn.conn();
        let result = script.execute(&mut redis_conn, &script_keys, &args).await?;

        match result {
            redis::Value::Int(code) if code < 0 => Err(Error::from_script_code(code)),
            _ => Ok(()),
        }
    }

    /// Calculate backoff delay for a retry attempt.
    /// Returns delay in ms, or -1 if custom backoff says don't retry.
    async fn calculate_backoff(
        strategy: &crate::types::BackoffStrategy,
        attempt: u32,
        error_msg: &str,
        job_data: &serde_json::Value,
        custom_fn: Option<&crate::options::BackoffStrategyFn>,
    ) -> i64 {
        match strategy {
            crate::types::BackoffStrategy::Fixed(delay) => *delay as i64,
            crate::types::BackoffStrategy::Exponential(base) => {
                (base * 2u64.pow(attempt.saturating_sub(1))) as i64
            }
            crate::types::BackoffStrategy::Custom(type_name) => {
                if let Some(f) = custom_fn {
                    f(attempt, type_name, error_msg, job_data).await
                } else {
                    0
                }
            }
        }
    }

    // ── Private: Fetch Job ───────────────────────────────────────────────

    async fn fetch_next_job(&self, token: &str, block: bool) -> Result<Option<Job>, Error> {
        Self::static_fetch_next_job(
            &self.conn,
            &self.blocking_conn,
            &self.keys,
            token,
            &self.opts,
            block,
        )
        .await
    }

    async fn static_fetch_next_job(
        conn: &RedisConnection,
        blocking_conn: &BlockingRedisConnection,
        keys: &QueueKeys,
        token: &str,
        opts: &WorkerOptions,
        block: bool,
    ) -> Result<Option<Job>, Error> {
        let script = conn
            .scripts()
            .get("moveToActive")
            .ok_or_else(|| Error::InvalidConfig("moveToActive script not found".to_string()))?
            .clone();

        let script_keys = vec![
            keys.wait(),
            keys.active(),
            keys.prioritized(),
            keys.events(),
            keys.stalled(),
            keys.limiter(),
            keys.delayed(),
            keys.paused(),
            keys.meta(),
            keys.pc(),
            keys.marker(),
        ];

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        let opts_packed = pack_move_to_active_opts(token, opts);

        let prefix_bytes = keys.key_prefix().into_bytes();
        let now_bytes = now.to_string().into_bytes();
        let args: Vec<&[u8]> = vec![&prefix_bytes, &now_bytes, &opts_packed];

        let mut redis_conn = conn.conn();
        let result = script.execute(&mut redis_conn, &script_keys, &args).await?;

        // Parse result
        match result {
            redis::Value::Nil => {
                if block {
                    // Wait for marker via BZPOPMIN
                    let marker_key = keys.marker();
                    let wait_result = blocking_conn
                        .bzpopmin(&marker_key, opts.drain_delay as f64)
                        .await?;

                    if wait_result.is_some() {
                        // Retry fetching
                        let mut redis_conn = conn.conn();
                        let retry_result =
                            script.execute(&mut redis_conn, &script_keys, &args).await?;
                        match Self::parse_move_to_active_result(&retry_result)? {
                            FetchResult::Job(job) => Ok(Some(*job)),
                            _ => Ok(None),
                        }
                    } else {
                        Ok(None)
                    }
                } else {
                    Ok(None)
                }
            }
            _ => match Self::parse_move_to_active_result(&result)? {
                FetchResult::Job(job) => Ok(Some(*job)),
                _ => Ok(None),
            },
        }
    }

    /// Parse the result of moveToActive script into a Job.
    fn parse_move_to_active_result(result: &redis::Value) -> Result<FetchResult, Error> {
        match result {
            redis::Value::Nil => Ok(FetchResult::Empty),
            redis::Value::Array(arr) if arr.len() >= 2 => {
                // The result is [HGETALL_data, job_id, expireTime, nextTimestamp]
                // arr[0] = array of field/value pairs from HGETALL
                // arr[1] = job ID (or "0" if no job)
                if let (
                    Some(redis::Value::Array(fields)),
                    Some(redis::Value::BulkString(id_bytes)),
                ) = (arr.first(), arr.get(1))
                {
                    let job_id = String::from_utf8_lossy(id_bytes).to_string();
                    if job_id == "0" || fields.is_empty() {
                        // No job available — check for rate limiting (3rd element)
                        let rate_limit_ttl = Self::extract_element_as_u64(arr, 2);
                        if rate_limit_ttl > 0 {
                            return Ok(FetchResult::RateLimited(rate_limit_ttl));
                        }
                        // Check for next delayed timestamp (4th element)
                        let next_ts = Self::extract_element_as_u64(arr, 3);
                        return if next_ts > 0 {
                            Ok(FetchResult::NextTimestamp(next_ts))
                        } else {
                            Ok(FetchResult::Empty)
                        };
                    }

                    // Parse the HGETALL array directly into a HashMap
                    let mut map = std::collections::HashMap::new();
                    let mut i = 0;
                    while i + 1 < fields.len() {
                        if let (redis::Value::BulkString(k), redis::Value::BulkString(v)) =
                            (&fields[i], &fields[i + 1])
                        {
                            let key = String::from_utf8_lossy(k).to_string();
                            let val = String::from_utf8_lossy(v).to_string();
                            map.insert(key, val);
                        }
                        i += 2;
                    }

                    if map.is_empty() {
                        return Ok(FetchResult::Empty);
                    }

                    Ok(FetchResult::Job(Box::new(Job::from_redis_hash(
                        &job_id, &map,
                    )?)))
                } else {
                    // Check for rate limiting (3rd element)
                    let rate_limit_ttl = Self::extract_element_as_u64(arr, 2);
                    if rate_limit_ttl > 0 {
                        return Ok(FetchResult::RateLimited(rate_limit_ttl));
                    }
                    // Check for nextTimestamp
                    let next_ts = Self::extract_element_as_u64(arr, 3);
                    if next_ts > 0 {
                        Ok(FetchResult::NextTimestamp(next_ts))
                    } else {
                        Ok(FetchResult::Empty)
                    }
                }
            }
            redis::Value::Int(code) if *code < 0 => Err(Error::from_script_code(*code)),
            _ => Ok(FetchResult::Empty),
        }
    }

    /// Extract the next delayed timestamp from a moveToActive result array.
    /// The script returns [data, jobId, expireTime, nextTimestamp].
    /// Extract a u64 value from an array element at the given index.
    fn extract_element_as_u64(arr: &[redis::Value], index: usize) -> u64 {
        if arr.len() > index {
            match &arr[index] {
                redis::Value::Int(v) if *v > 0 => *v as u64,
                redis::Value::BulkString(bs) => {
                    String::from_utf8_lossy(bs).parse::<u64>().unwrap_or(0)
                }
                _ => 0,
            }
        } else {
            0
        }
    }

    // ── Private: Progress Forwarder ──────────────────────────────────────

    async fn start_progress_forwarder(&self) {
        let mut progress_rx = self.progress_tx.subscribe();
        let event_tx = self.event_tx.clone();
        let closing = self.closing.clone();

        tokio::spawn(async move {
            loop {
                if closing.load(Ordering::Relaxed) {
                    break;
                }
                match progress_rx.recv().await {
                    Ok(evt) => {
                        let _ = event_tx.send(WorkerEvent::Progress {
                            job_id: evt.job_id,
                            progress: evt.progress,
                        });
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                }
            }
        });
    }

    // ── Private: Stalled Check ───────────────────────────────────────────

    async fn start_stalled_check(&self) {
        let conn = self.conn.clone();
        let keys = self.keys.clone();
        let closing = self.closing.clone();
        let event_tx = self.event_tx.clone();
        let interval = self.opts.stalled_interval;
        let max_stalled_count = self.opts.max_stalled_count;

        let handle = tokio::spawn(async move {
            let mut ticker = tokio::time::interval(Duration::from_millis(interval));
            ticker.tick().await; // Skip first immediate tick

            loop {
                ticker.tick().await;

                if closing.load(Ordering::Relaxed) {
                    break;
                }

                if let Err(e) =
                    Self::check_stalled_jobs(&conn, &keys, max_stalled_count, interval, &event_tx)
                        .await
                {
                    warn!(error = %e, "stalled check failed");
                }
            }
        });

        *self.stalled_check_handle.lock().await = Some(handle);
    }

    async fn check_stalled_jobs(
        conn: &RedisConnection,
        keys: &QueueKeys,
        max_stalled_count: u32,
        stalled_interval: u64,
        event_tx: &mpsc::UnboundedSender<WorkerEvent>,
    ) -> Result<(), Error> {
        let script = conn
            .scripts()
            .get("moveStalledJobsToWait")
            .ok_or_else(|| {
                Error::InvalidConfig("moveStalledJobsToWait script not found".to_string())
            })?
            .clone();

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        let script_keys = vec![
            keys.stalled(),
            keys.wait(),
            keys.active(),
            keys.stalled_check(),
            keys.meta(),
            keys.paused(),
            keys.marker(),
            keys.events(),
        ];

        let max_str = max_stalled_count.to_string().into_bytes();
        let prefix_bytes = keys.key_prefix().into_bytes();
        let now_bytes = now.to_string().into_bytes();
        let max_check_time = stalled_interval.to_string().into_bytes();
        let args: Vec<&[u8]> = vec![&max_str, &prefix_bytes, &now_bytes, &max_check_time];

        let mut redis_conn = conn.conn();
        let result = script.execute(&mut redis_conn, &script_keys, &args).await?;

        // Parse result for stalled job IDs
        if let redis::Value::Array(ref arr) = result {
            if let Some(redis::Value::Array(ref stalled_ids)) = arr.first() {
                for id_val in stalled_ids {
                    if let redis::Value::BulkString(ref id_bytes) = id_val {
                        let job_id = String::from_utf8_lossy(id_bytes).to_string();
                        let _ = event_tx.send(WorkerEvent::Stalled { job_id });
                    }
                }
            }
        }

        Ok(())
    }

    // ── Private: Lock Renewal ────────────────────────────────────────────

    async fn start_lock_renewal(&self) {
        let conn = self.conn.clone();
        let keys = self.keys.clone();
        let closing = self.closing.clone();
        let active_jobs = self.active_jobs.clone();
        let lock_duration = self.opts.lock_duration;
        let renew_time = self.opts.effective_lock_renew_time();

        let handle = tokio::spawn(async move {
            let mut ticker = tokio::time::interval(Duration::from_millis(renew_time));
            ticker.tick().await; // Skip first immediate tick

            loop {
                ticker.tick().await;

                let jobs = active_jobs.read().await;

                // Only stop when closing AND no active jobs remain
                if closing.load(Ordering::Relaxed) && jobs.is_empty() {
                    break;
                }

                if jobs.is_empty() {
                    continue;
                }

                // Extend locks for all active jobs
                let script = match conn.scripts().get("extendLock") {
                    Some(s) => s.clone(),
                    None => continue,
                };

                for active_job in jobs.iter() {
                    let job_key = keys.job_key(&active_job.job_id);
                    let lock_key = format!("{}:lock", job_key);
                    let script_keys = vec![lock_key, keys.stalled()];

                    let token_bytes = active_job.token.as_bytes();
                    let dur_bytes = lock_duration.to_string().into_bytes();
                    let job_id_bytes = active_job.job_id.as_bytes();
                    let args: Vec<&[u8]> = vec![token_bytes, &dur_bytes, job_id_bytes];

                    let mut redis_conn = conn.conn();
                    let _: Result<(), _> = script
                        .execute(&mut redis_conn, &script_keys, &args)
                        .await
                        .map(|_| ())
                        .map_err(|e| {
                            warn!(
                                job_id = %active_job.job_id,
                                error = %e,
                                "lock extension failed"
                            );
                        });
                }
            }
        });

        *self.lock_renew_handle.lock().await = Some(handle);
    }
}

impl Drop for Worker {
    fn drop(&mut self) {
        self.closing.store(true, Ordering::Release);
    }
}
