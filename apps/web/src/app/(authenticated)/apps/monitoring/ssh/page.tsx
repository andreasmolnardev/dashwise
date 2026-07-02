"use client";

import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { useSshSessions } from "@/components/monitoring/ssh/SshSessionsProvider";

export default function MonitoringSshPage() {
  const { hostId } = useParams();
  const { openSession } = useSshSessions();

  useEffect(() => {
    if (hostId) {
      openSession(hostId);
    }
  }, [hostId, openSession]);

  return null;
}
