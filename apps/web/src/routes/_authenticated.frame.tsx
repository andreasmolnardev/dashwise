"use client";
import { createFileRoute } from "@tanstack/react-router";

import { useNavigate, useSearchParams } from "react-router-dom";
import Screensaver from "@/components/dashboard/Screensaver";

export const Route = createFileRoute("/_authenticated/frame")({ component: FramePage });

export default function FramePage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  return (
    <Screensaver
      active
      onExit={() => {
        if (searchParams.get("closeAction") === "urlParam") {
          const nextParams = new URLSearchParams(searchParams);
          nextParams.set("closeActionTriggered", "1");
          setSearchParams(nextParams, { replace: true });
          return;
        }

        navigate("/home");
      }}
    />
  );
}
