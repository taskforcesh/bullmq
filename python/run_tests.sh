#!/bin/bash
redis-cli flushall
python3 -m tests.queue_tests
python3 -m tests.worker_tests