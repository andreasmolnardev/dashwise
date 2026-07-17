import NewsDashboardComponent from "@/components/news/NewsDashboard";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/apps/news/")({ component: NewsPage });

export default function NewsPage(){
    return <NewsDashboardComponent />
}
