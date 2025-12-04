defmodule BullMQ.Types do
  @moduledoc """
  Type definitions for BullMQ.

  This module defines the core types used throughout the BullMQ library.
  All types are designed to be compatible with the Node.js BullMQ library.
  """

  @typedoc """
  Job identifier, typically a string representation of an integer or UUID.
  """
  @type job_id :: String.t()

  @typedoc """
  Queue name.
  """
  @type queue_name :: String.t()

  @typedoc """
  Job name/type identifier.
  """
  @type job_name :: String.t()

  @typedoc """
  Job data payload. Can be any JSON-serializable term.
  """
  @type job_data :: map() | list() | String.t() | number() | boolean() | nil

  @typedoc """
  Job return value after processing.
  """
  @type job_return_value :: term()

  @typedoc """
  Processor result type.

  Processors can return various tagged tuples to control job flow:

  - `{:ok, result}` - Job completed successfully with result
  - `:ok` - Job completed successfully (no result)
  - `{:error, reason}` - Job failed with error
  - `{:delay, milliseconds}` - Move job to delayed queue (does not increment attempts)
  - `{:rate_limit, milliseconds}` - Move job back to wait and pause worker for duration
  - `:waiting` - Move job back to waiting queue
  - `:waiting_children` - Move job to waiting-children state (wait for child jobs)
  """
  @type processor_result ::
          {:ok, job_return_value()}
          | :ok
          | {:error, term()}
          | {:delay, duration_ms()}
          | {:rate_limit, duration_ms()}
          | :waiting
          | :waiting_children

  @typedoc """
  Job progress value - either a number (0-100) or custom progress data.
  """
  @type job_progress :: number() | map()

  @typedoc """
  Job state in the queue.
  """
  @type job_state ::
          :waiting
          | :active
          | :delayed
          | :prioritized
          | :completed
          | :failed
          | :waiting_children
          | :unknown

  @typedoc """
  Finished job states.
  """
  @type finished_status :: :completed | :failed

  @typedoc """
  Token used for job locking.
  """
  @type lock_token :: String.t()

  @typedoc """
  Timestamp in milliseconds since Unix epoch.
  """
  @type timestamp_ms :: non_neg_integer()

  @typedoc """
  Duration in milliseconds.
  """
  @type duration_ms :: non_neg_integer()

  @typedoc """
  Priority level (0 = highest priority).
  """
  @type priority :: non_neg_integer()

  @typedoc """
  Backoff strategy type.
  """
  @type backoff_type :: :fixed | :exponential | atom()

  @typedoc """
  Backoff configuration.
  """
  @type backoff_opts :: %{
          optional(:type) => backoff_type(),
          optional(:delay) => duration_ms(),
          optional(:jitter) => float()
        }

  @typedoc """
  Job removal configuration.
  - `true` - Remove immediately after completion/failure
  - `false` - Never remove
  - positive integer - Remove after this many milliseconds
  - `%{age: ms}` - Remove after job is older than this
  - `%{count: n}` - Keep only the last n jobs
  """
  @type keep_jobs ::
          boolean() | non_neg_integer() | %{age: duration_ms()} | %{count: non_neg_integer()}

  @typedoc """
  Worker failure behavior for parent jobs.
  """
  @type fail_parent_on_failure :: boolean()

  @typedoc """
  Ignore dependency behavior.
  """
  @type ignore_dependency :: boolean()

  @typedoc """
  Remove dependency behavior.
  """
  @type remove_dependency :: boolean()

  @typedoc """
  Job options for adding a job to the queue.
  """
  @type job_opts :: %{
          optional(:job_id) => job_id() | nil,
          optional(:priority) => priority(),
          optional(:delay) => duration_ms(),
          optional(:attempts) => pos_integer(),
          optional(:backoff) => backoff_opts(),
          optional(:lifo) => boolean(),
          optional(:timeout) => duration_ms(),
          optional(:remove_on_complete) => keep_jobs(),
          optional(:remove_on_fail) => keep_jobs(),
          optional(:timestamp) => timestamp_ms(),
          optional(:parent) => parent_opts(),
          optional(:repeat) => repeat_opts(),
          optional(:deduplication) => deduplication_opts(),
          optional(:fail_parent_on_failure) => fail_parent_on_failure(),
          optional(:ignore_dependency) => ignore_dependency(),
          optional(:remove_dependency) => remove_dependency(),
          optional(:telemetry_metadata) => String.t(),
          optional(:omit_context) => boolean()
        }

  @typedoc """
  Parent job reference options.
  """
  @type parent_opts :: %{
          required(:id) => job_id(),
          required(:queue) => queue_name(),
          optional(:prefix) => String.t()
        }

  @typedoc """
  Repeat/scheduling options.
  """
  @type repeat_opts :: %{
          optional(:pattern) => String.t(),
          optional(:every) => duration_ms(),
          optional(:limit) => pos_integer(),
          optional(:start_date) => DateTime.t() | timestamp_ms(),
          optional(:end_date) => DateTime.t() | timestamp_ms(),
          optional(:tz) => String.t(),
          optional(:immediately) => boolean(),
          optional(:offset) => duration_ms(),
          optional(:count) => non_neg_integer()
        }

  @typedoc """
  Deduplication options.

  ## Modes

  - **Simple Mode**: Only `:id` is provided. Jobs are deduplicated until completion or failure.
  - **Throttle Mode**: `:id` and `:ttl` provided. Jobs are deduplicated for the TTL duration.
  - **Debounce Mode**: `:id`, `:ttl`, `:extend`, and `:replace` all set. Each new job
    with the same ID extends the TTL and replaces the existing job data.

  ## Options

  - `:id` - (required) Unique identifier for deduplication
  - `:ttl` - Time-to-live in milliseconds for the deduplication key
  - `:extend` - If true, extend the TTL on each duplicate job
  - `:replace` - If true, replace the job data when a duplicate is added (while delayed)
  """
  @type deduplication_opts :: %{
          required(:id) => String.t(),
          optional(:ttl) => duration_ms(),
          optional(:extend) => boolean(),
          optional(:replace) => boolean()
        }

  @typedoc """
  Rate limiter configuration.
  """
  @type rate_limiter_opts :: %{
          required(:max) => pos_integer(),
          required(:duration) => duration_ms(),
          optional(:group_key) => String.t()
        }

  @typedoc """
  Worker options.

  Most options have sensible defaults and don't need to be changed:

  - `:lock_duration` - Default: 30,000ms. Time before a job lock expires. Should normally
    not be changed unless you have jobs that legitimately take longer than 30 seconds
    between progress updates.

  - `:stalled_interval` - Default: 30,000ms. How often to check for stalled jobs. Should
    normally not be changed. Must be less than `:lock_duration`.

  - `:max_stalled_count` - Default: 1. Number of times a job can stall before being moved
    to failed. We consider stalled jobs a rare occurrence, so stalling more than once
    typically indicates a more serious issue (e.g., worker crashes, resource exhaustion).
    Increasing this value is not recommended unless you have a specific use case.
  """
  @type worker_opts :: %{
          optional(:name) => atom() | String.t(),
          optional(:concurrency) => pos_integer(),
          optional(:lock_duration) => duration_ms(),
          optional(:lock_renew_time) => duration_ms(),
          optional(:stalled_interval) => duration_ms(),
          optional(:max_stalled_count) => non_neg_integer(),
          optional(:drain_delay) => duration_ms(),
          optional(:limiter) => rate_limiter_opts(),
          optional(:skip_stalled_check) => boolean(),
          optional(:remove_on_complete) => keep_jobs(),
          optional(:remove_on_fail) => keep_jobs(),
          optional(:autorun) => boolean(),
          optional(:prefix) => String.t(),
          optional(:metrics) => metrics_opts(),
          optional(:telemetry) => module(),
          optional(:on_completed) => (term(), term() -> any()),
          optional(:on_failed) => (term(), String.t() -> any()),
          optional(:on_error) => (term() -> any()),
          optional(:on_active) => (term() -> any()),
          optional(:on_progress) => (term(), term() -> any()),
          optional(:on_stalled) => (String.t() -> any()),
          optional(:on_lock_renewal_failed) => ([String.t()] -> any())
        }

  @typedoc """
  Metrics options.
  """
  @type metrics_opts :: %{
          optional(:max_data_points) => pos_integer()
        }

  @typedoc """
  Queue options.
  """
  @type queue_opts :: %{
          optional(:prefix) => String.t(),
          optional(:default_job_opts) => job_opts(),
          optional(:settings) => queue_settings(),
          optional(:telemetry) => module()
        }

  @typedoc """
  Queue settings.
  """
  @type queue_settings :: %{
          optional(:stalled_interval) => duration_ms(),
          optional(:max_stalled_count) => non_neg_integer(),
          optional(:lock_duration) => duration_ms()
        }

  @typedoc """
  Queue event types.
  """
  @type queue_event ::
          :added
          | :waiting
          | :active
          | :progress
          | :completed
          | :failed
          | :delayed
          | :stalled
          | :removed
          | :drained
          | :paused
          | :resumed
          | :duplicated
          | :deduplicated
          | :retries_exhausted
          | :waiting_children
          | :cleaned

  @typedoc """
  Redis connection specification.
  """
  @type redis_connection :: atom() | pid() | Redix.connection()

  @typedoc """
  Error reason.
  """
  @type error_reason :: atom() | String.t() | Exception.t()

  @typedoc """
  Result type with error.
  """
  @type result(ok_type) :: {:ok, ok_type} | {:error, error_reason()}

  @typedoc """
  Job JSON representation for Redis storage.
  """
  @type job_json :: %{
          required(:id) => job_id(),
          required(:name) => job_name(),
          required(:data) => String.t(),
          required(:opts) => String.t(),
          required(:timestamp) => timestamp_ms(),
          optional(:delay) => duration_ms(),
          optional(:priority) => priority(),
          optional(:processedOn) => timestamp_ms(),
          optional(:finishedOn) => timestamp_ms(),
          optional(:progress) => String.t(),
          optional(:returnvalue) => String.t(),
          optional(:failedReason) => String.t(),
          optional(:stacktrace) => String.t(),
          optional(:attemptsMade) => non_neg_integer(),
          optional(:attemptsStarted) => non_neg_integer(),
          optional(:stalledCounter) => non_neg_integer(),
          optional(:parentKey) => String.t(),
          optional(:parent) => String.t(),
          optional(:processedBy) => String.t(),
          optional(:rjk) => String.t(),
          optional(:deid) => String.t(),
          optional(:df) => String.t()
        }
end
