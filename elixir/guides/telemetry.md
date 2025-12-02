# Telemetry & Observability

BullMQ provides two complementary observability systems:

1. **Elixir Telemetry** - Local event-based metrics using `:telemetry`
2. **OpenTelemetry** - Distributed tracing across services

## OpenTelemetry (Distributed Tracing)

OpenTelemetry enables distributed tracing across service boundaries, allowing you to follow a job's journey through your entire system. This is compatible with Node.js BullMQ's OpenTelemetry integration.

### Why OpenTelemetry?

- **Distributed Tracing**: Follow a request across multiple services
- **Context Propagation**: Automatically link parent/child spans across queues
- **Cross-Language Support**: Trace jobs between Elixir, Node.js, and Python workers
- **Industry Standard**: Works with Jaeger, Zipkin, Honeycomb, Datadog, Grafana Tempo

### Installation

Add the optional OpenTelemetry dependencies to your \`mix.exs\`:

\`\`\`elixir
def deps do
[
{:bullmq, "~> 1.0"},

# OpenTelemetry API (required for tracing)

{:opentelemetry_api, "~> 1.0"},

# OpenTelemetry SDK (for exporting traces)

{:opentelemetry, "~> 1.0"},

# Exporter (choose one)

{:opentelemetry_exporter, "~> 1.0"} # OTLP exporter
]
end
\`\`\`

### Configuration

Configure OpenTelemetry in your \`config/runtime.exs\`:

\`\`\`elixir
config :opentelemetry,
resource: [
service: [name: "my-app"]
],
span_processor: :batch,
traces_exporter: :otlp

config :opentelemetry_exporter,
otlp_protocol: :http_protobuf,
otlp_endpoint: "http://localhost:4318"
\`\`\`

### Basic Usage

Enable telemetry when creating workers:

\`\`\`elixir

# Worker with OpenTelemetry

{:ok, worker} = BullMQ.Worker.start_link(
queue: "my-queue",
connection: :my_redis,
telemetry: BullMQ.Telemetry.OpenTelemetry,
processor: fn job -> # Your job is automatically wrapped in a span # linked to the producer's trace context
process_job(job)
{:ok, :done}
end
)
\`\`\`

### How It Works

1. **When adding a job**: If there's an active OpenTelemetry context, the trace context is serialized and stored in the job's \`telemetry_metadata\` option.

2. **When processing a job**: The worker extracts the trace context from the job and creates a child span linked to the producer's trace.

3. **Cross-service**: The serialized trace context (W3C Trace Context format) travels with the job through Redis, enabling distributed tracing across services and languages.

### Cross-Language Tracing

BullMQ's trace context is compatible with Node.js BullMQ (using \`bullmq-otel\`). A trace can flow seamlessly:

\`\`\`
[Node.js Service] [Elixir Worker] [Node.js Worker]
| | |
Add Job | |
(creates span) ──────────────| |
| Process Job |
| (child span, same trace) |
| | |
| Add Child Job ────────────────|
| | Process Job
| | (grandchild span)
\`\`\`

### Manual Tracing

Create additional spans within your processor:

\`\`\`elixir
alias BullMQ.Telemetry.OpenTelemetry, as: Tracer

def processor(job) do

# Create a child span for a specific operation

Tracer.trace("process.validate", [kind: :internal], fn \_span ->
validate_data(job.data)
end)

Tracer.trace("process.save", [kind: :client], fn \_span ->
save_to_database(job.data)
end)

{:ok, :processed}
end
\`\`\`

### Span Attributes

Automatic spans include these attributes:

| Attribute              | Description            |
| ---------------------- | ---------------------- |
| \`bullmq.queue.name\`  | Queue name             |
| \`bullmq.job.id\`      | Job ID                 |
| \`bullmq.job.name\`    | Job name               |
| \`bullmq.job.attempt\` | Current attempt number |

Add custom attributes:

\`\`\`elixir
Tracer.trace("my.operation", [], fn span ->
Tracer.set_attribute(span, "user.id", user_id)
Tracer.set_attribute(span, "order.amount", amount)
do_work()
end)
\`\`\`

### Job Options for Telemetry

| Option                 | Type    | Default | Description                         |
| ---------------------- | ------- | ------- | ----------------------------------- |
| \`telemetry_metadata\` | string  | nil     | Serialized trace context (auto-set) |
| \`omit_context\`       | boolean | false   | Skip trace context propagation      |

\`\`\`elixir

# Disable tracing for a specific job

BullMQ.Queue.add("queue", "job", %{}, omit_context: true)
\`\`\`

### Graceful Degradation

The OpenTelemetry adapter gracefully degrades:

- **API not installed**: All tracing functions become no-ops
- **SDK not configured**: Spans are created but not exported
- **Runtime errors**: Caught and logged, job processing continues

This means you can enable telemetry safely:

\`\`\`elixir

# In dev, just the API - spans are created but go nowhere

{:opentelemetry_api, "~> 1.0"}

# In prod, add the SDK and exporter

{:opentelemetry, "~> 1.0"},
{:opentelemetry_exporter, "~> 1.0"}
\`\`\`

### Viewing Traces

Popular tools for viewing OpenTelemetry traces:

- **Jaeger**: Open-source, self-hosted
- **Zipkin**: Open-source, self-hosted
- **Honeycomb**: SaaS with powerful querying
- **Datadog**: Full observability platform
- **Grafana Tempo**: Open-source, integrates with Grafana

Example Jaeger setup:

\`\`\`yaml

# docker-compose.yml

services:
jaeger:
image: jaegertracing/all-in-one:latest
ports: - "16686:16686" # UI - "4318:4318" # OTLP HTTP
\`\`\`

\`\`\`elixir

# config/runtime.exs

config :opentelemetry_exporter,
otlp_protocol: :http_protobuf,
otlp_endpoint: "http://localhost:4318"
\`\`\`

---

## Elixir Telemetry (Local Metrics)

BullMQ also integrates with Elixir's \`:telemetry\` library for local metrics and monitoring. This is separate from OpenTelemetry and is used for metrics aggregation (counters, histograms, gauges).

### Event Reference

All events are prefixed with \`[:bullmq, ...]\`.

#### Job Events

| Event                          | Measurements           | Metadata                                                   |
| ------------------------------ | ---------------------- | ---------------------------------------------------------- |
| \`[:bullmq, :job, :add]\`      | \`queue_time\`         | \`queue\`, \`job_id\`, \`job_name\`                        |
| \`[:bullmq, :job, :start]\`    | \`system_time\`        | \`queue\`, \`job_id\`, \`job_name\`, \`worker\`            |
| \`[:bullmq, :job, :complete]\` | \`duration\`           | \`queue\`, \`job_id\`, \`job_name\`, \`worker\`            |
| \`[:bullmq, :job, :fail]\`     | \`duration\`           | \`queue\`, \`job_id\`, \`job_name\`, \`worker\`, \`error\` |
| \`[:bullmq, :job, :retry]\`    | \`attempt\`, \`delay\` | \`queue\`, \`job_id\`, \`job_name\`                        |
| \`[:bullmq, :job, :progress]\` | \`progress\`           | \`queue\`, \`job_id\`                                      |

#### Worker Events

| Event                                  | Measurements              | Metadata              |
| -------------------------------------- | ------------------------- | --------------------- |
| \`[:bullmq, :worker, :start]\`         | \`concurrency\`           | \`queue\`, \`worker\` |
| \`[:bullmq, :worker, :stop]\`          | \`uptime\`                | \`queue\`, \`worker\` |
| \`[:bullmq, :worker, :stalled_check]\` | \`recovered\`, \`failed\` | \`queue\`             |

#### Queue Events

| Event                          | Measurements | Metadata  |
| ------------------------------ | ------------ | --------- |
| \`[:bullmq, :queue, :pause]\`  | -            | \`queue\` |
| \`[:bullmq, :queue, :resume]\` | -            | \`queue\` |
| \`[:bullmq, :queue, :drain]\`  | -            | \`queue\` |

#### Rate Limiting Events

| Event                            | Measurements | Metadata  |
| -------------------------------- | ------------ | --------- |
| \`[:bullmq, :rate_limit, :hit]\` | \`delay\`    | \`queue\` |

### Basic Handler

\`\`\`elixir
defmodule MyApp.BullMQTelemetry do
require Logger

def setup do
events = [
[:bullmq, :job, :complete],
[:bullmq, :job, :fail],
[:bullmq, :rate_limit, :hit]
]

    :telemetry.attach_many(
      "bullmq-logger",
      events,
      &__MODULE__.handle_event/4,
      nil
    )

end

def handle_event([:bullmq, :job, :complete], measurements, metadata, \_config) do
duration_ms = System.convert_time_unit(measurements.duration, :native, :millisecond)
Logger.info("Job #{metadata.job_id} completed in #{duration_ms}ms")
end

def handle_event([:bullmq, :job, :fail], \_measurements, metadata, \_config) do
Logger.error("Job #{metadata.job_id} failed: #{inspect(metadata.error)}")
end

def handle_event([:bullmq, :rate_limit, :hit], measurements, metadata, \_config) do
Logger.warning("Rate limit hit on #{metadata.queue}, pausing for #{measurements.delay}ms")
end
end

# In your application.ex

def start(\_type, \_args) do
MyApp.BullMQTelemetry.setup()

# ... rest of supervision tree

end
\`\`\`

### Prometheus Integration

Using [Telemetry.Metrics](https://hexdocs.pm/telemetry_metrics) and [TelemetryMetricsPrometheus](https://hexdocs.pm/telemetry_metrics_prometheus):

\`\`\`elixir
defmodule MyApp.Metrics do
import Telemetry.Metrics

def metrics do
[ # Job duration histogram
distribution(
"bullmq.job.duration",
event_name: [:bullmq, :job, :complete],
measurement: :duration,
unit: {:native, :millisecond},
tags: [:queue, :job_name],
reporter_options: [
buckets: [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000]
]
),

      # Job counter
      counter(
        "bullmq.job.count",
        event_name: [:bullmq, :job, :complete],
        tags: [:queue, :job_name]
      ),

      # Failure counter
      counter(
        "bullmq.job.failures",
        event_name: [:bullmq, :job, :fail],
        tags: [:queue, :job_name]
      ),

      # Rate limit hits
      counter(
        "bullmq.rate_limit.hits",
        event_name: [:bullmq, :rate_limit, :hit],
        tags: [:queue]
      ),

      # Worker concurrency gauge
      last_value(
        "bullmq.worker.concurrency",
        event_name: [:bullmq, :worker, :start],
        measurement: :concurrency,
        tags: [:queue]
      )
    ]

end
end

# In your supervision tree

children = [
{TelemetryMetricsPrometheus, metrics: MyApp.Metrics.metrics()}
]
\`\`\`

### StatsD Integration

Using [TelemetryMetricsStatsd](https://hexdocs.pm/telemetry_metrics_statsd):

\`\`\`elixir
defmodule MyApp.Metrics do
import Telemetry.Metrics

def metrics do
[
counter("bullmq.job.complete", tags: [:queue]),
counter("bullmq.job.fail", tags: [:queue]),
distribution("bullmq.job.duration", unit: {:native, :millisecond}),
sum("bullmq.rate_limit.delay", tags: [:queue])
]
end
end

children = [
{TelemetryMetricsStatsd,
metrics: MyApp.Metrics.metrics(),
host: "localhost",
port: 8125
}
]
\`\`\`

### Grafana Queries (Prometheus)

\`\`\`promql

# Job throughput by queue

rate(bullmq_job_count_total[5m])

# Average job duration

rate(bullmq_job_duration_sum[5m]) / rate(bullmq_job_duration_count[5m])

# Failure rate

rate(bullmq_job_failures_total[5m]) / rate(bullmq_job_count_total[5m])

# P99 job duration

histogram_quantile(0.99, rate(bullmq_job_duration_bucket[5m]))
\`\`\`

---

## Best Practices

### 1. Use Both Systems Together

- **OpenTelemetry** for distributed tracing (understanding request flow)
- **Elixir Telemetry** for metrics aggregation (dashboards, alerts)

### 2. Tag by Queue and Job Name

\`\`\`elixir
distribution("bullmq.job.duration",
event_name: [:bullmq, :job, :complete],
tags: [:queue, :job_name]
)
\`\`\`

### 3. Set Up Alerts

\`\`\`yaml

# Prometheus alert rules

groups:

- name: bullmq
  rules: - alert: HighFailureRate
  expr: rate(bullmq_job_failures_total[5m]) > 0.1
  for: 5m
  labels:
  severity: warning
  annotations:
  summary: "High job failure rate" - alert: JobDurationHigh
  expr: histogram_quantile(0.99, rate(bullmq_job_duration_bucket[5m])) > 60000
  for: 10m
  labels:
  severity: warning
  \`\`\`

### 4. Log Failures with Context

\`\`\`elixir
def handle_event([:bullmq, :job, :fail], measurements, metadata, \_config) do
Logger.error(
"Job failed",
job_id: metadata.job_id,
job_name: metadata.job_name,
queue: metadata.queue,
duration_ms: measurements.duration / 1_000_000,
error: inspect(metadata.error)
)
end
\`\`\`

## Custom Telemetry Implementation

You can implement your own telemetry backend:

\`\`\`elixir
defmodule MyApp.CustomTelemetry do
@behaviour BullMQ.Telemetry.Behaviour

@impl true
def start_span(name, opts) do # Your implementation
end

@impl true
def end_span(span, status) do # Your implementation
end

# ... implement all callbacks

end

# Use it

{:ok, worker} = BullMQ.Worker.start_link(
queue: "my-queue",
connection: :my_redis,
telemetry: MyApp.CustomTelemetry,
processor: &process/1
)
\`\`\`

## Next Steps

- Learn about [Workers](workers.md) for processing configuration
- Set up [Queue Events](queue_events.md) for real-time monitoring
- Configure [Rate Limiting](rate_limiting.md)
- Explore [OpenTelemetry](https://opentelemetry.io/) documentation
