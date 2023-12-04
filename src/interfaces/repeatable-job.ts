export type RepeatableJob = {
  key: string;
  name: string;
  id: string | null;
  endDate: number | null;
  tz: string | null;
  pattern: string;
  next: number;
};
