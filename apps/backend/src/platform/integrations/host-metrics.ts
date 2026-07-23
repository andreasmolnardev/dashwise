import type { IntegrationHealth } from "./remote-lifecycle";

export type HostMetricEntry = Record<string, unknown>;
export type HostMetricsSubscriber = (entry: HostMetricEntry) => void;

/** Public capability contract for integrations that expose host metrics. */
export interface HostMetricsSource<THost> {
  health(host: THost): Promise<IntegrationHealth>;
  latest(host: THost): Promise<HostMetricEntry | null>;
  history(host: THost, from?: string | null): Promise<unknown>;
  subscribe(hostId: string, callback: HostMetricsSubscriber): () => void;
  start(): Promise<void>;
  stop(hostId?: string): void;
}
