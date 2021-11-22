import { ChildCommand } from '.';
import { JobJson } from '../classes';

export interface ParentMessage {
  cmd: ChildCommand;
  value?: any;
  err?: Error;
  job?: JobJson;
}
