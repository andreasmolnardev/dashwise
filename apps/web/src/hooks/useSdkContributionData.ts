"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useAuth from "@/context/useAuth";
import { useActivity } from "@/context/ActivityContext";
import { resolveSdkContributionAction, type SdkContributionKind } from "@/lib/apiClient";

type ContributionDataState = {
  data: Record<string, unknown> | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
};

function revisionKey(collectionId: string, resourceId: string) {
  return JSON.stringify([collectionId, resourceId]);
}

/** Resolve SDK contribution bindings and refresh when one of their resources changes. */
export function useSdkContributionData({
  instanceId,
  kind,
  contributionId,
  config,
  enabled = true,
}: {
  instanceId?: string;
  kind: SdkContributionKind;
  contributionId?: string;
  config?: Record<string, unknown>;
  enabled?: boolean;
}): ContributionDataState {
  const { withAuth } = useAuth();
  const { subscribeSdkResources } = useActivity();
  const configKey = useMemo(() => JSON.stringify(config ?? {}), [config]);
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const latestRevisions = useRef(new Map<string, number>());

  const refresh = useCallback(() => setRefreshVersion((version) => version + 1), []);

  useEffect(() => {
    if (!enabled || !instanceId || !contributionId) {
      setData(null);
      setLoading(false);
      setError(null);
      latestRevisions.current.clear();
      return;
    }

    let disposed = false;
    let unsubscribe = () => {};
    let resolving = false;
    let refreshAfterCurrentRequest = false;
    const selectedConfig = JSON.parse(configKey) as Record<string, unknown>;
    latestRevisions.current.clear();

    const resolve = async () => {
      if (disposed || resolving) return;
      resolving = true;
      setLoading(true);
      setError(null);
      try {
        const result = await withAuth((auth) => resolveSdkContributionAction(
          auth,
          instanceId,
          kind,
          contributionId,
          selectedConfig,
        ));
        if (disposed) return;

        latestRevisions.current = new Map(result.revisions.map((revision) => [
          revisionKey(revision.collectionId, revision.resourceId),
          revision.revision,
        ]));
        setData(result.data);
        unsubscribe();
        unsubscribe = subscribeSdkResources(
          result.revisions.map((revision) => ({
            instanceId,
            collectionId: revision.collectionId,
            resourceId: revision.resourceId,
          })),
          (event) => {
            const key = revisionKey(event.collectionId, event.resourceId);
            const currentRevision = latestRevisions.current.get(key) ?? -1;
            if (event.revision <= currentRevision) return;
            latestRevisions.current.set(key, event.revision);
            if (resolving) {
              refreshAfterCurrentRequest = true;
              return;
            }
            void resolve();
          },
        );
      } catch (cause) {
        if (!disposed) {
          setData(null);
          setError(cause instanceof Error ? cause.message : "Integration data could not be loaded.");
        }
      } finally {
        resolving = false;
        if (!disposed) {
          setLoading(false);
          if (refreshAfterCurrentRequest) {
            refreshAfterCurrentRequest = false;
            queueMicrotask(() => void resolve());
          }
        }
      }
    };

    void resolve();
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [configKey, contributionId, enabled, instanceId, kind, refreshVersion, subscribeSdkResources, withAuth]);

  return { data, loading, error, refresh };
}
