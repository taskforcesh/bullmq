import { spawn } from 'node:child_process';
import {
  PARITY_EVENT_TYPES,
  ParityEvent,
  ParityEventType,
  ParityTestData,
} from './types';
import { time } from 'node:console';

export type ParityTestBackend = 'Postgres' | 'Redis';

interface LaunchSpecs {
  args: string[];
  timeout?: number;
}

export interface ParityTestImplementation {
  name: string;
  consumer: LaunchSpecs;
  producer: LaunchSpecs;
}

export type RunCommandAs = 'producer' | 'consumer';

export class ParityTestScript {
  constructor(
    public backend: ParityTestBackend,
    public base: ParityTestImplementation,
    public alternate: ParityTestImplementation,
  ) {}

  title(flipped: boolean) {
    if (flipped) {
      // When flipped: command[1] is the producer command[0] is the consumer
      return `${this.alternate.name}(Producer) - ${this.backend}`;
    }
    return `${this.alternate.name}(Consumer) - ${this.backend}`;
  }

  private getCommand(
    as: RunCommandAs,
    flipped: boolean,
  ): [string, LaunchSpecs] {
    if (as === 'producer') {
      if (flipped) {
        return [this.alternate.name, this.alternate.producer];
      }
      return [this.base.name, this.base.producer];
    }

    if (flipped) {
      return [this.base.name, this.base.consumer];
    }
    return [this.alternate.name, this.alternate.consumer];
  }

  /**
   * This function spawns up a child process for a producer or a consumer
   * It watches the process and automatically picks test events from stdout and stderr
   * Any log that's not matched as a test event is logged to stdout prefixed with the command
   * the backend and the part it's acting either as a producer or as a consumer
   * @param as - Can be 'producer' or 'consumer' based on what command needs to be run
   * @param flipped - In a flipped scenario, command 0 and command 1 switch the roles of producer and consumer
   * @param backend_port - The port to use to connect to the inmemory backend
   * @param handlers - Functions to handle
   * @returns - A function that can be used to kill the script
   */
  run(
    as: RunCommandAs,
    flipped: boolean,
    backend_port: number,
    handlers: {
      onReady: () => void;
      onClose: () => void;
      onUpdate: (type: ParityEventType, data: ParityTestData) => void;
    },
  ) {
    const run_id = crypto.randomUUID();
    const [name, specs] = this.getCommand(as, flipped);

    const child = spawn('bash', specs.args, {
      env: {
        PARITY_RUN_ID: run_id,
        PARITY_BACKEND: this.backend.toLowerCase(),
        PARITY_BACKEND_PORT: backend_port.toString(),
      },
    });

    const logPrefix = `[${name}:${this.backend}:${as.toUpperCase()}]`;

    const timeout = specs.timeout ?? 3000;

    const readiness_timeout = setTimeout(() => {
      console.error(`${logPrefix} - Killed, wasn't ready after ${timeout}ms`);
      child.kill();
    });

    let partialLine = '';

    const processOutput = (text: string) => {
      const lines = (partialLine + text).split('\n');

      partialLine = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) {
          continue;
        }
        // Each line is expected to be a valid JSON with the key's 'event' and 'test_id'
        try {
          const event: ParityEvent = JSON.parse(line);
          if (typeof event?.type !== 'string') {
            console.log(`${logPrefix} - ${line}`);
            continue;
          }

          if (
            !PARITY_EVENT_TYPES.includes(event?.type) ||
            event?.run_id !== run_id
          ) {
            console.log(`${logPrefix} - ${line}`);
            continue;
          }

          switch (event.type) {
            case 'ready':
              clearTimeout(readiness_timeout);
              handlers.onReady();
              break;
            default:
              handlers.onUpdate(event.type, event.data);
              break;
          }
        } catch (err) {
          // Each update event is expected to be valid JSON, simply ignore parsing errors
          console.log(`${logPrefix} - ${line}`);
        }
      }
    };

    child.stdout.on('data', chunk => processOutput(chunk.toString()));
    child.stderr.on('data', chunk => processOutput(chunk.toString()));

    child.on('close', () => {
      // Process the last line completed
      processOutput(partialLine + '\n');

      handlers.onClose();
    });

    return () => {
      if (child.killed) {
        return;
      }
      child.kill();
    };
  }
}
