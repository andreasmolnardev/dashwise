import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/news")({
  beforeLoad: () => { throw redirect({ to: "/apps/news", replace: true }); },
});
