-- BullMQ PostgreSQL backend — deduplication stale-key recovery.
--
-- Replaces `deduplicate_job` (created in 0002_functions.sql) to fix two ways a
-- deduplication key could outlive the job it points at:
--
--   1. Stale key: a key with no expiry is meant to disappear when its winner
--      finishes, but `clean`, `drain`, `obliterate` (and outages) delete the
--      job row without clearing the `dedup` row. Every later add then matched
--      that dead winner and was silently dropped, forever. Mirrors the Redis
--      `recoverStaleDeduplicationKey` include.
--   2. Orphaned proto-next: replacing a *delayed* winner left behind any
--      `dedup_next` payload stashed while that winner was previously active,
--      so it got resurrected when the replacement finished.
--
-- Only the function body changes — no schema/DDL change — so the signature is
-- identical and older clients keep working against the updated schema.

CREATE OR REPLACE FUNCTION deduplicate_job(
  p_queue text, p_dedup jsonb, p_job_id text, p_now bigint,
  p_name text, p_data jsonb, p_opts jsonb
) RETURNS text
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_id       text    := p_dedup->>'id';
  v_ttl      bigint  := NULLIF(p_dedup->>'ttl', '')::bigint;
  v_extend   boolean := COALESCE((p_dedup->>'extend')::boolean, false);
  v_replace  boolean := COALESCE((p_dedup->>'replace')::boolean, false);
  v_keeplast boolean := COALESCE((p_dedup->>'keepLastIfActive')::boolean, false);
  v_cur      text;
  v_exp      bigint;
  v_state    job_state;
BEGIN
  IF v_id IS NULL OR v_id = '' THEN
    RETURN NULL;
  END IF;

  -- The current winner (only if the key is still live).
  SELECT job_id, expire_at_ms INTO v_cur, v_exp
    FROM dedup WHERE queue = p_queue AND dedup_id = v_id;
  IF v_cur IS NULL OR (v_exp IS NOT NULL AND v_exp <= p_now) THEN
    v_cur := NULL;
  ELSIF v_exp IS NULL AND NOT EXISTS (
    SELECT 1 FROM job WHERE queue = p_queue AND id = v_cur
  ) THEN
    -- Stale key recovery (mirrors recoverStaleDeduplicationKey): a key with no
    -- expiry is meant to disappear when its winner finishes. If the job row is
    -- gone (clean, drain, obliterate, an outage…) the key is stale, so discard
    -- it together with any pending proto-next (which would otherwise be
    -- resurrected) and start a new window with the incoming job.
    DELETE FROM dedup WHERE queue = p_queue AND dedup_id = v_id;
    DELETE FROM dedup_next WHERE queue = p_queue AND dedup_id = v_id;
    v_cur := NULL;
  END IF;

  IF v_replace THEN
    IF v_cur IS NOT NULL THEN
      SELECT state INTO v_state
        FROM job WHERE queue = p_queue AND id = v_cur;
      IF v_state = 'delayed' THEN
        -- Drop the previous delayed job and take its place.
        DELETE FROM job WHERE queue = p_queue AND id = v_cur;
        PERFORM publish_event(p_queue, 'removed',
          jsonb_build_object('jobId', v_cur, 'prev', 'delayed'));
        PERFORM publish_event(p_queue, 'deduplicated',
          jsonb_build_object('jobId', p_job_id, 'deduplicationId', v_id,
            'deduplicatedJobId', v_cur));
        -- Discard any pending proto-next stashed while the replaced job was
        -- active, otherwise it would be resurrected when p_job_id finalizes.
        DELETE FROM dedup_next WHERE queue = p_queue AND dedup_id = v_id;
        IF v_keeplast THEN
          UPDATE dedup SET job_id = p_job_id, expire_at_ms = NULL
           WHERE queue = p_queue AND dedup_id = v_id;
        ELSIF NOT v_extend AND COALESCE(v_ttl, 0) > 0 THEN
          -- KEEPTTL: keep the existing window, just swap the winner.
          UPDATE dedup SET job_id = p_job_id
           WHERE queue = p_queue AND dedup_id = v_id;
        ELSE
          UPDATE dedup
             SET job_id = p_job_id,
                 expire_at_ms = CASE WHEN COALESCE(v_ttl, 0) > 0
                                     THEN p_now + v_ttl ELSE NULL END
           WHERE queue = p_queue AND dedup_id = v_id;
        END IF;
        RETURN NULL;
      ELSE
        -- Winner is not a removable delayed job: stash proto-next if it is
        -- active + keepLastIfActive, then deduplicate.
        PERFORM dedup_store_next(p_queue, v_id, v_cur, p_job_id,
          v_keeplast, p_name, p_data, p_opts);
        RETURN v_cur;
      END IF;
    ELSE
      INSERT INTO dedup (queue, dedup_id, job_id, expire_at_ms)
        VALUES (p_queue, v_id, p_job_id,
          CASE WHEN NOT v_keeplast AND COALESCE(v_ttl, 0) > 0
               THEN p_now + v_ttl ELSE NULL END)
      ON CONFLICT (queue, dedup_id) DO UPDATE
        SET job_id = EXCLUDED.job_id, expire_at_ms = EXCLUDED.expire_at_ms;
      RETURN NULL;
    END IF;
  END IF;

  -- Without replace.
  IF COALESCE(v_ttl, 0) > 0 AND v_extend THEN
    IF v_cur IS NOT NULL THEN
      -- Stash proto-next if active+keepLast; else extend the window (or
      -- persist when keepLastIfActive). Either way keep the current winner.
      IF NOT dedup_store_next(p_queue, v_id, v_cur, p_job_id,
               v_keeplast, p_name, p_data, p_opts) THEN
        UPDATE dedup
           SET expire_at_ms = CASE WHEN v_keeplast THEN NULL ELSE p_now + v_ttl END
         WHERE queue = p_queue AND dedup_id = v_id;
      END IF;
      PERFORM publish_event(p_queue, 'deduplicated',
        jsonb_build_object('jobId', v_cur, 'deduplicationId', v_id,
          'deduplicatedJobId', p_job_id));
      RETURN v_cur;
    END IF;
    INSERT INTO dedup (queue, dedup_id, job_id, expire_at_ms)
      VALUES (p_queue, v_id, p_job_id,
        CASE WHEN v_keeplast THEN NULL ELSE p_now + v_ttl END)
    ON CONFLICT (queue, dedup_id) DO UPDATE
      SET job_id = EXCLUDED.job_id, expire_at_ms = EXCLUDED.expire_at_ms;
    RETURN NULL;
  END IF;

  -- SET NX semantics (ttl>0 non-extend, or no ttl at all).
  IF v_cur IS NOT NULL THEN
    PERFORM dedup_store_next(p_queue, v_id, v_cur, p_job_id,
      v_keeplast, p_name, p_data, p_opts);
    PERFORM publish_event(p_queue, 'deduplicated',
      jsonb_build_object('jobId', v_cur, 'deduplicationId', v_id,
        'deduplicatedJobId', p_job_id));
    RETURN v_cur;
  END IF;

  INSERT INTO dedup (queue, dedup_id, job_id, expire_at_ms)
    VALUES (p_queue, v_id, p_job_id,
      CASE WHEN NOT v_keeplast AND COALESCE(v_ttl, 0) > 0
           THEN p_now + v_ttl ELSE NULL END)
  ON CONFLICT (queue, dedup_id) DO UPDATE
    SET job_id = EXCLUDED.job_id, expire_at_ms = EXCLUDED.expire_at_ms;
  RETURN NULL;
END;
$$;
