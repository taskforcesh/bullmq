import { ParentCommand } from '../enums/parent-command';

export interface ChildMessage {
  cmd: ParentCommand;
  requestId?: string;
  value?: any;
  err?: Record<string, any>;
}
