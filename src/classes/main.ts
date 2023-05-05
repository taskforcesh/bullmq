/**
 * Child process wrapper for sandboxing.
 *
 */
import { childSend } from '../utils';
import masterBase from './main-base';

masterBase((msg: any) => childSend(process, msg), process);
