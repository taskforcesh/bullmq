/**
 * First we import Mocha and it's type definitions.
 */
// @deno-types="https://unpkg.com/@types/mocha@7.0.2/index.d.ts"
import 'https://unpkg.com/mocha@7.2.0/mocha.js';
/**
 * Here I'm using the Deno `expect` library, but you can use
 * any assertion library - including Deno's std testing library.
 * See: https://deno.land/std/testing
 */
import { expect } from 'https://deno.land/x/expect@v0.2.1/mod.ts';

/**
 * Callback on completion of tests to ensure Deno exits with
 * the appropriate status code.
 */
function onCompleted(failures: number): void {
  if (failures > 0) {
    Deno.exit(1);
  } else {
    Deno.exit(0);
  }
}

/**
 * Browser based Mocha requires `window.location` to exist.
 */
(window as any).location = new URL('http://localhost:0');

/**
 * In order to use `describe` etc. we need to set Mocha to `bdd`
 * mode.
 *
 * We also need to set the reporter to `spec` (though other options
 * are available) to prevent Mocha using the default browser reporter
 * which requires access to a DOM.
 */
mocha.setup({ ui: 'bdd', reporter: 'spec' });

/**
 * Ensure there are no leaks in our tests.
 */
mocha.checkLeaks();

/**
 * Our example function under test
 */
function add(a: number, b: number): number {
  return a + b;
}

/**
 * We write our tests as usual!
 */
describe('add', () => {
  it('should add two positive numbers correctly', () => {
    expect(add(2, 3)).toEqual(5);
  });
});

/**
 * And finally we run our tests, passing the onCompleted function
 * hook and setting some globals.
 */
mocha.run(onCompleted).globals(['onerror']);
