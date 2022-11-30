import { ParentCommand } from './parent-command';

export interface ChildMessage {
  cmd: ParentCommand;
  value?: any;
  err?: Error;
}
