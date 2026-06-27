// Note: this Polyfill is only needed for Node versions < 15.4.0
import { AbortController as AbortControllerPolyfill } from 'node-abort-controller';

let AbortControllerImpl: typeof AbortControllerPolyfill;

// prefer native AbortController implementation if found
if (globalThis.AbortController) {
  AbortControllerImpl =
    globalThis.AbortController as typeof AbortControllerPolyfill;
} else {
  AbortControllerImpl = AbortControllerPolyfill;
}

export class AbortController extends AbortControllerImpl {}
