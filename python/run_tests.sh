#!/bin/bash
python3 flush_redis.py
./copy_scripts.sh
python3 -m pytest -v