import NewsDashboardComponent from "@/components/news/NewsDashboard";
import NewsOverview from "@/components/news/NewsOverview";
import { useParams } from "react-router-dom";

export default function NewsPage() {
    const { feedId } = useParams();

    return feedId === "overview" ? <NewsOverview /> : <NewsDashboardComponent />;
}
