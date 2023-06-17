from setuptools import setup
from bullmq import __version__

# To use a consistent encoding
from codecs import open
from os import path

# Get the long description from the README file
with open(path.join(".", 'README.md'), encoding='utf-8') as f:
    long_description = f.read()

setup(
    name='bullmq',
    version=__version__,
    description='BullMQ for Python',
    long_description=long_description,
    long_description_content_type="text/markdown",
    url='https://bullmq.io',
    author='Taskforce.sh Inc.',
    author_email='manast@taskforce.sh',
    license='MIT',
    packages=['bullmq'],
    package_data={'bullmq': ['commands/*.lua', 'types/*']},
    install_requires=[
        'redis',
        'msgpack',
        'semver',
    ],
    extras_require={
        "dev": [
            "pre-commit==3.3.3",
            "python-semantic-release==7.34.3",
        ]
    },
    classifiers=[
        'Development Status :: 3 - Alpha',
        'Intended Audience :: Developers',
        'License :: OSI Approved :: MIT License',  
        'Operating System :: POSIX :: Linux',        
        'Programming Language :: Python :: 2',
        'Programming Language :: Python :: 2.7',
        'Programming Language :: Python :: 3',
        'Programming Language :: Python :: 3.4',
        'Programming Language :: Python :: 3.5',
    ],
)
