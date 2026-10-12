"use client";

import { useEffect, useState } from "react";
import Widget from "@dashwise/integrationskit/Widget";
import Glanceable from "@dashwise/integrationskit/Glanceable";
import useAuth from "@/context/useAuth";
import { getSdkContributionDefinitionAction, type SdkContributionKind } from "@/lib/apiClient";
import { useSdkContributionData } from "@/hooks/useSdkContributionData";
import type { SdkContributionAddress } from "./sdkContributionKey";
import { parseSdkContributionKey } from "./sdkContributionKey";

export { parseSdkContributionKey } from "./sdkContributionKey";
export type { SdkContributionAddress } from "./sdkContributionKey";

type SdkGlanceableFormatters = {
  formatTemperature?: (value: number | null | undefined, inputUnit?: string, options?: { includeUnit?: boolean; decimals?: number }) => string;
  formatTime?: (value?: Date | string | number, options?: Intl.DateTimeFormatOptions) => string;
  formatDate?: (value?: Date | string | number, format?: string) => string;
};

function useSdkContributionDefinition(address: SdkContributionAddress) {
  const { withAuth } = useAuth();
  const [contribution, setContribution] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setContribution(null);
    setError(null);
    void withAuth((auth) => getSdkContributionDefinitionAction(
      auth,
      address.instanceId,
      address.kind,
      address.contributionId,
    )).then((next) => {
      if (!cancelled) setContribution(next);
    }).catch((cause) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : "Integration contribution could not be loaded.");
    });
    return () => { cancelled = true; };
  }, [address.contributionId, address.instanceId, address.kind, withAuth]);

  return { contribution, error };
}

function getContributionConfig(
  contribution: Record<string, unknown> | null,
  config: Record<string, unknown> | undefined,
) {
  if (!contribution || !config) return {};

  const schema = contribution.configSchema;
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return {};

  const schemaRecord = schema as Record<string, unknown>;
  const properties = schemaRecord.properties;
  const fields = properties && typeof properties === "object" && !Array.isArray(properties)
    ? properties as Record<string, unknown>
    : schemaRecord;

  return Object.fromEntries(
    Object.keys(fields)
      .filter((key) => Object.prototype.hasOwnProperty.call(config, key))
      .map((key) => [key, config[key]]),
  );
}

export function SdkIntegrationWidget({
  address,
  config,
  isPreview = false,
  className,
}: {
  address: SdkContributionAddress;
  config?: Record<string, unknown>;
  isPreview?: boolean;
  className?: string;
}) {
  const { contribution, error } = useSdkContributionDefinition(address);
  const contributionConfig = getContributionConfig(contribution, config);
  const resolved = useSdkContributionData({
    ...address,
    config: contributionConfig,
    enabled: !isPreview && !!contribution,
  });

  if (error) return <div className={`frosted rounded-lg p-3 text-sm text-red-200 ${className ?? ""}`}>{error}</div>;
  if (!contribution) return <div className={`frosted rounded-lg p-3 text-sm text-white/60 ${className ?? ""}`}>Loading integration widget…</div>;
  if (resolved.error) return <div className={`frosted rounded-lg p-3 text-sm text-red-200 ${className ?? ""}`}>{resolved.error}</div>;

  const exampleData = contribution.exampleProps && typeof contribution.exampleProps === "object"
    ? contribution.exampleProps as Record<string, unknown>
    : null;
  return (
    <Widget
      widgetKey={address.contributionId}
      widgetJSON={contribution}
      input={contributionConfig}
      data={isPreview ? exampleData : resolved.data}
      isPreview={false}
      className={className}
    />
  );
}

export function SdkIntegrationGlanceable({
  address,
  config,
  formatters,
  className,
}: {
  address: SdkContributionAddress;
  config?: Record<string, unknown>;
  formatters?: SdkGlanceableFormatters;
  className?: string;
}) {
  const { contribution, error } = useSdkContributionDefinition(address);
  const contributionConfig = getContributionConfig(contribution, config);
  const resolved = useSdkContributionData({ ...address, config: contributionConfig, enabled: !!contribution });

  if (error || resolved.error) {
    return <span className={`text-xs text-red-200 ${className ?? ""}`}>{error ?? resolved.error}</span>;
  }
  if (!contribution) return <span className={`text-xs text-white/60 ${className ?? ""}`}>Loading…</span>;
  return (
    <Glanceable
      glanceableJSON={contribution}
      data={resolved.data}
      params={contributionConfig}
      formatters={formatters}
      className={className}
    />
  );
}
