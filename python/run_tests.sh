#!/bin/bash
redis-cli flushall
python3 -m unittest -v tests.job_tests
