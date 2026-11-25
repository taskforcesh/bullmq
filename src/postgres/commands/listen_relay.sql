-- Subscribe to the relay channel. Publishers
-- `pg_notify('bullmq_relay', <namespace>:<node id>)`; a node filters for its own.
LISTEN bullmq_relay;
