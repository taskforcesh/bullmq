# Relay compared to Kafka

The Relay and Kafka both move messages between processes, but they solve
different problems. Kafka is a durable, replayable **event log** for data
pipelines. The Relay is **live messaging** between the processes of an
application, running on the Redis or PostgreSQL you already use for BullMQ.

## At a glance

|                         | Kafka                                                                              | Relay                                                                                                                                |
| ----------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Model**               | An append-only, partitioned log. Consumers pull by offset.                         | Live messages, pushed into the inbox of each interested node.                                                                        |
| **Who gets a message**  | One consumer per consumer group; several groups can each read it.                  | Every matching subscription (fan-out). For exactly one consumer, use a BullMQ queue.                                                 |
| **History and replay**  | Yes. Messages are kept for a retention period, and can be re-read from any offset. | No. A subscription only sees what is published after it. [Retained messages](retained-messages.md) keep the latest value of a topic. |
| **Durability**          | Replicated to disk; survives broker and consumer failures.                         | Survives a node's brief disconnections. A node removed after missing its lease loses its pending messages.                           |
| **Topics**              | Heavyweight: created up front and partitioned; usually a limited number.           | Free and fine-grained: one per job, user or resource. They only cost anything while someone subscribes.                              |
| **Wildcards**           | Regex subscriptions to topic names.                                                | Hierarchical patterns (`tenants.acme.>`, `jobs.*.cancel`), resolved by the datastore on every publish.                               |
| **Ordering**            | Total order per partition (by key).                                                | Per publisher: messages published one after another arrive in that order.                                                            |
| **Delivery guarantees** | At-least-once by default; exactly-once with idempotent producers and transactions. | Once per subscription while the node is alive; no replay.                                                                            |
| **Throughput**          | Very high; scales horizontally with partitions and brokers.                        | Bounded by one Redis slot or one PostgreSQL database per namespace: suited to control and notification traffic, not bulk data.       |
| **Infrastructure**      | A separate cluster, operated as its own system.                                    | Nothing beyond what BullMQ already uses.                                                                                             |
| **Liveness**            | Consumer group membership and rebalancing.                                         | Node leases: dead nodes are removed with their subscriptions.                                                                        |

## How BullMQ maps to Kafka's concepts

- **Consumer group semantics** (each message processed once, with retries)
  are BullMQ **queues**, which also offer delays, priorities, per-job retries
  with backoff, rate limits and flows.
- **Fan-out to live processes** is the **Relay**.
- **A compacted topic** (the latest value per key) is roughly a **retained
  message**, kept per topic and for a limited time.
- **A replayable log** has no equivalent, by design: when a message must be
  processed reliably, put it in a queue.

## When to use which

**Kafka**: event sourcing, analytics and ETL pipelines, change data capture,
many independent consumers that must each process the full history, very
high volumes.

**The Relay**: signals between the processes of your application: cancel
this job, show this progress, invalidate this cache entry, apply this
configuration, notify this user. These messages are small, targeted and only
useful now. Kafka would be heavy for them: per-job topics aren't practical,
it is one more cluster to operate, and replaying old signals has no use.

They also work well together: Kafka for the data pipeline, BullMQ queues for
the work, and the Relay to keep the live parts of the application in sync.
