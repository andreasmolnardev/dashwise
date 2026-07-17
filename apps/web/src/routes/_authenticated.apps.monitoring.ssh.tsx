"use client";
import { createFileRoute } from "@tanstack/react-router";

import { useEffect } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useSshSessions } from "@/components/monitoring/ssh/SshSessionsProvider";

export const Route = createFileRoute("/_authenticated/apps/monitoring/ssh")({ component: MonitoringSshPage });

export default function MonitoringSshPage() {
  const { hostId } = useParams();
  const [searchParams] = useSearchParams();
  const { openSession } = useSshSessions();
  const queryHostId = searchParams.get("host");
  const selectedHostId = hostId || queryHostId;

  useEffect(() => {
    if (selectedHostId) {
      openSession(selectedHostId);
    }
  }, [openSession, selectedHostId]);

  return null;
}
