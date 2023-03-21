from setuptools import setup

# To use a consistent encoding
from codecs import open
from os import path

# Get the long description from the README file
with open(path.join(".", 'README.md'), encoding='utf-8') as f:
    long_description = f.read()

setup(
    name='bullmq',
    version='0.1.0',    
    description='BullMQ for Python',
    long_description=long_description,
    long_description_content_type="text/markdown",
    url='https://bullmq.io',
    author='Taskforce.sh Inc.',
    author_email='manast@taskforce.sh',
    license='MIT',
    packages=['bullmq'],
    package_data={'bullmq': ['commands/*.lua']},
    install_requires=['redis',
                      'msgpack',            
                      ],
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
