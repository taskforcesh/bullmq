/**
 * Parity runner implementation
 */
import { readFile } from 'node:fs/promises';
import { OneSidedScripResults, ParityTestCase } from './types';
import { RunnerState } from './state';
import { ParityTestBackend, ParityTestScript } from './script';
import { startBackend } from './backend';
import { TestReportBuilder } from './report';

async function runOneSidedScript(
  script: ParityTestScript,
  backend: ParityTestBackend,
  switchRoles: boolean,
  definitions: ParityTestCase[],
): Promise<OneSidedScripResults> {
  const abortController = new AbortController();

  const backendPort = await startBackend(backend, abortController.signal);
  const state = new RunnerState(definitions, abortController.signal);

  // Called after the consumer is ready
  // The resolve function should be called when ready or closed
  // confirming that the test can proceed to waiting and evaluation
  const runProducer = (resolve: () => void) => {
    script.launch(
      'producer',
      backend,
      switchRoles,
      backendPort,
      {
        onClose: () => {
          resolve();

          // Partially evaluate the tests for producer related outcomes - if there's a failure, no point to proceed
          if (!state.producerOk()) {
            abortController.abort();
          }
        },
        onReady: status => {
          if (status === 'ready') {
            // Start timing the tests for evaluation
            state.start();
          } else {
            state.skipUnsupported();
          }
          resolve();
        },
        onUpdate: (event_type, data) =>
          state.recordEvent('producer', event_type, data),
      },
      abortController.signal,
    );
  };

  // Wait for the consumer and producer to be ready
  await new Promise<void>(resolve => {
    script.launch(
      'consumer',
      backend,
      switchRoles,
      backendPort,
      {
        onClose: () => {
          // Resolve to allow the test to proceed
          resolve();
          // Kill any pending timers and proceed with evaluation
          abortController.abort();
        },
        onReady: status => {
          if (status === 'ready') {
            runProducer(resolve);
          } else {
            state.skipUnsupported();
            resolve();
          }
        },
        onUpdate: (event_type, data) =>
          state.recordEvent('consumer', event_type, data),
      },
      abortController.signal,
    );
  });

  // Waits until all the timers run out or the test is aborted
  const results = await state.evaluateResults(
    `${script.title(backend)} as ${switchRoles ? 'Producer' : 'Consumer'}`,
  );

  // Kill scripts if they're still running
  abortController.abort();

  return results;
}

export async function runScript(
  script: ParityTestScript,
  backend: ParityTestBackend,
) {
  const definitions: ParityTestCase[] = JSON.parse(
    await readFile('./parity/definitions.json', 'utf-8'),
  );

  const [consumerResult, producerResult] = await Promise.all([
    runOneSidedScript(script, backend, false, definitions),
    runOneSidedScript(script, backend, true, definitions),
  ]);

  const report = new TestReportBuilder(
    script.title(backend),
    definitions,
    consumerResult,
    producerResult,
  );

  await report.buildAndWrite();

  return report.hasPassed();
}
