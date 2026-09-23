-- The timestamp of the next delayed job, or NULL if there are none.
SELECT next_delay($1) AS next_delay;
