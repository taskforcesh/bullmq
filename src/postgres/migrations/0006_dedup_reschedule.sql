-- Reschedule delayed deduplication winners without replacing their payload.
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
  v_delay    bigint;
  v_cur      text;
  v_exp      bigint;
  v_state    job_state;
BEGIN
  IF v_id IS NULL OR v_id = '' THEN
    RETURN NULL;
  END IF;

  SELECT job_id, expire_at_ms INTO v_cur, v_exp
    FROM dedup WHERE queue = p_queue AND dedup_id = v_id;
  IF v_cur IS NULL OR (v_exp IS NOT NULL AND v_exp <= p_now) THEN
    v_cur := NULL;
  ELSIF v_exp IS NULL AND NOT EXISTS (
    SELECT 1 FROM job WHERE queue = p_queue AND id = v_cur
  ) THEN
    DELETE FROM dedup WHERE queue = p_queue AND dedup_id = v_id;
    DELETE FROM dedup_next WHERE queue = p_queue AND dedup_id = v_id;
    v_cur := NULL;
  END IF;

  IF v_replace THEN
    IF v_cur IS NOT NULL THEN
      SELECT state INTO v_state
        FROM job WHERE queue = p_queue AND id = v_cur;
      IF v_state = 'delayed' THEN
        DELETE FROM job WHERE queue = p_queue AND id = v_cur;
        PERFORM publish_event(p_queue, 'removed',
          jsonb_build_object('jobId', v_cur, 'prev', 'delayed'));
        PERFORM publish_event(p_queue, 'deduplicated',
          jsonb_build_object('jobId', p_job_id, 'deduplicationId', v_id,
            'deduplicatedJobId', v_cur));
        DELETE FROM dedup_next WHERE queue = p_queue AND dedup_id = v_id;
        IF v_keeplast THEN
          UPDATE dedup SET job_id = p_job_id, expire_at_ms = NULL
           WHERE queue = p_queue AND dedup_id = v_id;
        ELSIF NOT v_extend AND COALESCE(v_ttl, 0) > 0 THEN
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

  IF v_cur IS NOT NULL AND COALESCE((p_dedup->>'reschedule')::boolean, false) THEN
    v_delay := COALESCE((p_opts->>'delay')::bigint, 0);
    UPDATE job SET delay_ms = v_delay,
                   process_at_ms = p_now + GREATEST(v_delay, 0)
     WHERE queue = p_queue AND id = v_cur AND state = 'delayed';
    IF FOUND THEN
      PERFORM publish_event(p_queue, 'delayed',
        jsonb_build_object('jobId', v_cur, 'delay', p_now + GREATEST(v_delay, 0)));
      PERFORM pg_notify('bullmq_jobs', p_queue);
    END IF;
  END IF;

  IF COALESCE(v_ttl, 0) > 0 AND v_extend THEN
    IF v_cur IS NOT NULL THEN
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
