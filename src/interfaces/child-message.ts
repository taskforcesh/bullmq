import { ParentCommand } from '.';

export interface ChildMessage {
  cmd: ParentCommand;
  value?: any;
  err?: Error;
}
