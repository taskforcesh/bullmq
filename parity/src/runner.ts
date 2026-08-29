/**
 * Parity runner implementation
 */
import { readFile } from 'node:fs/promises';
import { ParityTestCase } from './types';
import { RunnerState } from './state';
import { ParityTestScript } from './script';
import { startBackend } from './backend';

export async function runScript(script: ParityTestScript, flipped: boolean) {
  const definitions: ParityTestCase[] = JSON.parse(
    await readFile('./parity/definitions.json', 'utf-8'),
  );

  const killFunctions: { producer?: () => void; consumer?: () => void } = {};

  const backendInstance = await startBackend(script.backend);
  const state = new RunnerState(definitions);

  // Called after the consumer is ready
  // The resolve function should be called when ready or closed
  // confirming that the test can proceed to waiting and evaluation
  const runProducer = (resolve: () => void) => {
    killFunctions.producer = script.run(
      'producer',
      flipped,
      backendInstance.port,
      {
        onClose: () => {
          resolve();

          // Partially evaluate the tests for producer related outcomes - if there's a failure, no point to proceed
          if (!state.producerOk()) {
            state.abort();
          }
        },
        onReady: () => {
          resolve();
          // Start timing the tests for evaluation
          state.start();
        },
        onUpdate: (event_type, data) =>
          state.recordEvent('producer', event_type, data),
      },
    );
  };

  // Wait for the consumer and producer to be ready
  await new Promise<void>(resolve => {
    killFunctions.consumer = script.run(
      'consumer',
      flipped,
      backendInstance.port,
      {
        onClose: () => {
          // Resolve to allow the test to proceed
          resolve();
          // Kill any pending timers and proceed with evaluation
          state.abort();
        },
        onReady: () => runProducer(resolve),
        onUpdate: (event_type, data) =>
          state.recordEvent('consumer', event_type, data),
      },
    );
  });

  // Waits until all the timers run out or the test is aborted
  const passed = await state.evaluateAndReport(script.title(flipped));

  // Kill scripts if they're still running
  killFunctions.consumer?.();
  killFunctions.producer?.();

  // Kill in memory servers
  await backendInstance.close();

  return passed;
}
