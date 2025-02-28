#!/bin/bash
BULLMQ_TEST_PREFIX="{b}"
python3 -m unittest -v tests.bulk_tests
python3 -m unittest -v tests.delay_tests
python3 -m unittest -v tests.flow_tests
python3 -m unittest -v tests.job_tests
python3 -m unittest -v tests.queue_tests
python3 -m unittest -v tests.worker_tests