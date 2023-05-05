/**
 * Child process wrapper for sandboxing.
 *
 */
import { childSend } from '../utils';
import mainBase from './main-base';

mainBase((msg: any) => childSend(process, msg), process);
