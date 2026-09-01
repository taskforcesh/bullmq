import { exec, spawn } from 'node:child_process';
import {
  PARITY_EVENT_TYPES,
  ParityEvent,
  ParityEventType,
  ParityTestData,
} from './types';

export type ParityTestBackend = 'Postgres' | 'Redis';

interface LaunchSpecs {
  command: string;
  args: string[];
  timeout?: number;
  // Optional - set a working directory relative to the root of the project
  cwd?: string;
  debug?: boolean; // Prints events from the command to console
}

export interface ParityTestImplementation {
  name: string;
  consumer: LaunchSpecs;
  producer: LaunchSpecs;
}

export type ParityScriptType = 'producer' | 'consumer';

export class ParityTestScript {
  constructor(
    public base: ParityTestImplementation, // Assumes primary role as producer
    public alternate: ParityTestImplementation, // Assumes primary role as consumer
  ) {}

  title(backend: ParityTestBackend) {
    return `${this.alternate.name} - ${backend}`;
  }

  private getLaunchSpecs(
    scriptType: ParityScriptType,
    switchRoles: boolean,
  ): [string, LaunchSpecs] {
    if (scriptType === 'producer') {
      if (switchRoles) {
        return [this.alternate.name, this.alternate.producer];
      }
      return [this.base.name, this.base.producer];
    }

    if (switchRoles) {
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
   */
  async launch(
    scriptType: ParityScriptType,
    backend: ParityTestBackend,
    switchRoles: boolean,
    backendPort: number,
    handlers: {
      onReady: (status: 'ready' | 'not-supported') => void;
      onClose: () => void;
      onUpdate: (type: ParityEventType, data: ParityTestData) => void;
    },
    abortSignal: AbortSignal,
  ) {
    const run_id = crypto.randomUUID();
    const [name, specs] = this.getLaunchSpecs(scriptType, switchRoles);
    const logPrefix = `[${name}:${backend}:${scriptType}]`;

    // Spawn expects the full path of the command - this finds the full path on unix based systems
    const command = await new Promise<string>(resolve =>
      exec(`which ${specs.command}`, (err, stdout, stderr) => {
        resolve(stdout.trim());
      }),
    );

    let cwd = process.cwd();
    if (specs.cwd) {
      cwd = `${cwd}/${specs.cwd}`;
    }

    const child = spawn(command, specs.args, {
      env: {
        PARITY_RUN_ID: run_id,
        PARITY_BACKEND: backend.toLowerCase(),
        PARITY_BACKEND_PORT: backendPort.toString(),
      },
      cwd,
    });

    const timeout = specs.timeout ?? 3000;

    const readiness_timeout = setTimeout(() => {
      console.error(`TIMEOUT ${timeout}ms ${logPrefix}`);
      child.kill();
    }, timeout);

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
            console.log(`${logPrefix} ${line}`);
            continue;
          }

          if (
            !PARITY_EVENT_TYPES.includes(event?.type) ||
            event?.run_id !== run_id
          ) {
            console.log(`${logPrefix} ${line}`);
            continue;
          }

          if (event?.type === 'ready' || event?.type === 'not-supported') {
            clearTimeout(readiness_timeout);
            console.log(`${event.type.toUpperCase()} ${logPrefix}`);
            handlers.onReady(event.type);
            continue;
          }

          if (specs.debug) {
            console.log(`DEBUG ${logPrefix} ${line}`);
          }
          handlers.onUpdate(event.type, event.data);
        } catch (err) {
          // Each update event is expected to be valid JSON, simply ignore parsing errors
          console.log(`${logPrefix} ${line}`);
        }
      }
    };

    child.stdout.on('data', chunk => processOutput(chunk.toString()));
    child.stderr.on('data', chunk => processOutput(chunk.toString()));

    child.on('close', () => {
      clearTimeout(readiness_timeout);
      console.log(`CLOSED - ${logPrefix}`);
      // Process the last line completed
      processOutput(partialLine + '\n');

      handlers.onClose();
    });

    abortSignal.addEventListener('abort', () => {
      if (!child.killed) {
        child.kill('SIGKILL');
      }
    });
  }
}
