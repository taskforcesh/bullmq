import { ParentCommand } from '../enums/parent-command';

export interface ChildMessage {
  cmd: ParentCommand;
  value?: any;
  err?: Record<string, any>;
}
