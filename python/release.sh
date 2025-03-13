#!/usr/bin/env bash
rm -Rf dist
rm -Rf bullmq.egg-info
yarn build bullmq # latest version
python -m build
twine upload dist/*
