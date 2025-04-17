export interface Receiver {
  on: (evt: 'message', cb: (msg: any) => void) => void;
  off: (evt: 'message', cb: (msg: any) => void) => void;
}
