import ScreensaverSettings from "@/components/settings/ScreensaverSettings";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/settings/screensaver")({ component: ScreensaverPage });

export default function ScreensaverPage() {
  return <ScreensaverSettings/>;
}
