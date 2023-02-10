from setuptools import setup

setup(
    name='bullmq',
    version='0.1.0',    
    description='BullMQ for Python',
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
        'Development Status :: Alpha',
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
