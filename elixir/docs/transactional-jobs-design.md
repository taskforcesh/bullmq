# Design: Transactional Jobs (Postgres backend)

**Status:** Proposal / feasibility note
**Applies to:** `BullMQ.Backends.Postgres` only (not Redis)

## Goal

Let a job's processor run its own database work **inside the same transaction
that BullMQ uses to complete the job**, so that the business-logic writes and the
job completion commit atomically together. If either fails, both roll back —
which removes the classic at-least-once double-write window and makes idempotent
processors unnecessary.

## Why this is possible with Postgres (and impossible with Redis)

The completion protocol on the Postgres backend is already a single SQL function,
`move_to_completed(...)`, invoked from the adapter's `run/3` helper. That
function is **transaction-agnostic**: it works the same whether it runs on a
pooled connection or inside a caller-supplied `BEGIN … COMMIT`. That is the only
hook required.

Redis cannot do this: arbitrary user SQL can't be enrolled into a `MULTI/EXEC`.

## The problem today: two commits

Processing currently spans **two separate transactions**:

1. `move_to_active` → commit (job becomes locked and visible as `active`)
2. processor runs (user side effects, in the user's _own_ transaction)
3. `move_to_completed` → separate commit

The gap between (2) and (3) is the at-least-once window: if the worker crashes
after the user's writes commit but before completion commits, the lock expires →
the job is treated as stalled → it is reclaimed and reprocessed → **double side
effects**. This is why processors must be idempotent.

## The design: share only _process + complete_

You must **not** fold the _claim_ (`move_to_active`) into the shared transaction.
An uncommitted "active" state is invisible to other transactions, so two workers
could claim the same job. Locking depends on the claim being committed.

Instead, fold only **process + complete** into one transaction. The lock acquired
at claim time provides mutual exclusion; the shared transaction provides
atomicity of side-effects + completion:

```elixir
# 1. Claim stays a separate commit → job is locked and visible as active.
move_to_active(backend, token, opts)

# 2. Process + complete share ONE transaction → single COMMIT.
Postgrex.transaction(pool, fn conn ->
  result = processor.(job, conn)      # user's queries run on THIS conn
  Postgrex.query!(conn, move_to_completed_sql, params)  # same tx
  result
end)
```

### Guarantees

- **Crash mid-processing (before COMMIT):** the user's writes roll back; the job
  stays `active` and locked → reclaimed → clean retry. No partial side effects,
  so **no idempotence needed**.
- **Lock expired mid-processing (slow job):** `move_to_completed` detects the
  token mismatch and fails, so the _entire_ transaction — including the user's
  writes — rolls back. This is exactly the "never double-write" property: a
  worker whose lease expired can never commit its side effects.

## What would change in the code

| Piece                      | Change                                                                                                                                                 | Effort   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| SQL                        | none — `move_to_completed` already runs in any transaction                                                                                             | none     |
| Backend adapter            | add a connection-scoped variant of the completion path (`run/3` currently hardcodes the pool) + an optional callback, e.g. `complete_in_transaction/3` | Moderate |
| Worker                     | wrap processor + completion in `Postgrex.transaction`, thread `conn` into the processor                                                                | Moderate |
| Processor API              | give the processor the transaction handle (`processor.(job, tx)` or `job.tx`)                                                                          | Small    |
| `BullMQ.Backend` behaviour | mark it an **optional, backend-specific capability** (Redis returns "unsupported")                                                                     | Small    |

## The hard / careful parts

1. **Pool sizing.** A transactional job holds a dedicated connection for its
   entire duration; concurrency is then bounded by `pool_size` and long jobs pin
   connections. Requires `pool_size ≥ in-flight transactional jobs`. This is the
   main operational trade-off vs Redis (which releases connections between ops).
2. **Ecto integration.** Trivial if the processor uses the raw Postgrex `conn` we
   hand it; harder if users want their **Ecto Repo** calls to join the
   transaction (Ecto doesn't cleanly adopt an external Postgrex connection). This
   is the biggest integration question and dictates the public API shape.
3. **`move_to_failed`.** Usually you want the opposite: roll back the user's work
   but still **persist** the failure. So failures can't share the commit — roll
   back the user transaction, then record the failure separately.
4. **`fetch_next` fast path.** The fused claim-next-job optimization must be
   disabled for transactional jobs (the next claim would be uncommitted until the
   outer commit) or handled specially.
5. **Lock renewal.** Fine as-is: `extend_lock` runs on a separate connection and
   the completion transaction only touches the job row at the very end, so there
   is no lock contention during the long user work.

## Verdict

**Very feasible — moderate effort for raw-Postgrex processors, more for Ecto
integration.** The core is roughly a few hundred lines plus one optional
behaviour callback, because the SQL already supports it. It is essentially the
"transactional job" / exactly-once-via-shared-transaction pattern offered by
Oban Pro and River (Go), and it is a real differentiator the Redis backend can
never match.

Two things to settle before committing to it:

- the **Ecto story** (it determines the public API), and
- an explicit **pool-sizing contract** so long jobs don't starve the pool.
