import { ChildCommand } from './child-command';
import { JobJson } from './job-json';

export interface ParentMessage {
  cmd: ChildCommand;
  value?: any;
  err?: Error;
  job?: JobJson;
}
