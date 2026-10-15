import { useParams } from "react-router-dom";
import { usePageConfig } from "@/hooks/usePageConfig";
import PageNotFound from "@/components/errorPages/PageNotFound";
import DashboardLayoutTemplate from "@/components/dashboard/DashboardLayoutTemplate";

export default function DashboardPageFromConfig() {
    const params = useParams();
    const pageName = params.page || "home";
    const { config, loading } = usePageConfig({ pageName });

    if (!loading && !config) return <PageNotFound pageName={pageName} />;

    return <DashboardLayoutTemplate config={config} pageName={pageName} isLoading={loading} />;
}
