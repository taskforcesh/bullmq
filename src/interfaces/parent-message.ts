import { ChildCommand } from '.';

export interface ParentMessage {
  cmd: ChildCommand;
  value?: any;
  err?: Error;
}
