"use client";

import { useNavigate } from "react-router-dom";
import Screensaver from "@/components/dashboard/Screensaver";

export default function FramePage() {
  const navigate = useNavigate();

  return (
    <Screensaver
      active
      onExit={() => {
        navigate("/home");
      }}
    />
  );
}
