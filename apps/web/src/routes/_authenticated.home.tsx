import { createFileRoute } from "@tanstack/react-router";
import DynamicPage from "./_authenticated.$page";

export const Route = createFileRoute("/_authenticated/home")({ component: DynamicPage });
