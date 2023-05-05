/**
 * Worker Thread wrapper for sandboxing
 *
 */
import { parentPort } from 'worker_threads';
import masterBase from './main-base';

masterBase(async (msg: any) => parentPort.postMessage(msg), parentPort);
