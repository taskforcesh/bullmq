#!/bin/bash
python flush_redis.py
python -m unittest discover -s tests/ -p "*_tests.py" -t .