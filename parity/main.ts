import { writeFile } from 'fs/promises';
import { runScript } from './src/runner';
import { ParityTestImplementation, ParityTestScript } from './src/script';

const baseImplementation: ParityTestImplementation = {
  name: 'Node.JS',
  consumer: {
    command: 'node',
    args: ['--import', 'tsx', 'tests/parity/node-consumer.ts'],
  },
  producer: {
    command: 'node',
    args: ['--import', 'tsx', 'tests/parity/node-producer.ts'],
  },
};

const otherImplementations: ParityTestImplementation[] = [
  {
    name: 'Bun Native',
    consumer: {
      command: 'bun',
      args: ['tests/parity/bun-consumer.ts'],
    },
    producer: {
      command: 'bun',
      args: ['tests/parity/bun-producer.ts'],
    },
  },
  // {
  //   name: 'Rust',
  //   consumer: {
  //     args: [],
  //   },
  //   producer: {
  //     args: [],
  //   },
  // },
  {
    name: 'Python',
    consumer: {
      command: 'poetry',
      args: ['run', 'python', 'tests/parity/consumer.py'],
      cwd: 'python',
    },
    producer: {
      command: 'poetry',
      args: ['run', 'python', 'tests/parity/producer.py'],
      cwd: 'python',
    },
  },
];

const REPORT_HEADER = `# Feature Alignment Report
- **Last Run**: ${new Date().toISOString()}
- **Base Implementation** : ${baseImplementation.name}

`;

async function main() {
  await writeFile('./parity/REPORT.md', REPORT_HEADER);

  let exitCode = 0;
  for (const alternateImplementation of otherImplementations) {
    const script = new ParityTestScript(
      baseImplementation,
      alternateImplementation,
    );
    // Test both scripts as producer and consumer in parallel
    const results = await Promise.all([
      runScript(script, 'Redis'),
      runScript(script, 'Postgres'),
    ]);

    for (const result of results) {
      if (!result) {
        exitCode = 1;
      }
    }
  }

  if (exitCode === 0) {
    console.log('All tests passed');
  } else {
    console.error('Some tests failed');
  }

  process.exit(exitCode);
}

main().catch(err => {
  console.log(
    'An error occurred while running parity tests, please fix and retry',
    err,
  );
  process.exit(1);
});
