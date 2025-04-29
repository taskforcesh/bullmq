// TODO: remove this type in favor of JobSchedulerJson in next breaking change
export type RepeatableJob = {
  key: string;
  name: string;
  id?: string | null;
  endDate: number | null;
  tz: string | null;
  pattern: string | null;
  every?: string | null;
  next?: number;
};
