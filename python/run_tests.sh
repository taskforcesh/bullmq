#!/bin/bash
redis-cli flushall
python3 -m unittest -v tests.job_tests
python3 -m unittest -v tests.queue_tests
python3 -m unittest -v tests.worker_tests