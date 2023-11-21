/**
 * Worker Thread wrapper for sandboxing
 *
 */
import { parentPort } from 'worker_threads';
import mainBase from './main-base';

mainBase(async (msg: any) => parentPort.postMessage(msg), parentPort);
