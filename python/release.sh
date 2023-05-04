#!/usr/bin/env bash
# https://betterscientificsoftware.github.io/python-for-hpc/tutorials/python-pypi-packaging/
rm -Rf dist
rm -Rf bullmq.egg-info
# yarn build bullmq latest version
python setup.py sdist
twine upload dist/*
