import { readFile } from 'node:fs/promises';

export function logEvent(event_type: string, data?: any) {
  const run_id = process.env.PARITY_RUN_ID;
  console.log(JSON.stringify({ type: event_type, run_id, data }));
}

export async function readDefinitons<T>(): Promise<T[]> {
  const content = await readFile('./parity/definitions.json', 'utf-8');
  return JSON.parse(content);
}
