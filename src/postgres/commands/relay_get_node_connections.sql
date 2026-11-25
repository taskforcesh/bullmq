-- The inbox (LISTEN) connection of a relay node, named after it through
-- `application_name`, as PostgreSQL sees it.
-- Params: $1 application name, $2 database.
SELECT COALESCE(host(client_addr) || ':' || client_port, 'local') AS address,
       floor(extract(epoch FROM now() - backend_start))::integer AS age,
       floor(extract(epoch FROM now() - COALESCE(state_change, backend_start)))::integer AS idle
  FROM pg_stat_activity
 WHERE application_name = $1
   AND datname = $2
 ORDER BY backend_start;
