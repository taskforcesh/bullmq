export interface Metrics {
  meta: {
    count: number;
    prevTS: number;
    prevCount: number;
  };
  data: number[];
  count: number;
}
