
import useAuth from "@/context/useAuth";
import { useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { getPageConfigAction } from "../../../actions/pageConfigs";
import PageNotFound from "@/components/errorPages/PageNotFound";
import DashboardLayoutTemplate from "@/components/dashboard/DashboardLayoutTemplate";
import type { PageConfig } from "@dashwise/types/sdk/data/pageConfig";

export default function DashboardPageFromConfig() {
    const params = useParams();
    const { withAuth } = useAuth();
    const pageName = (params?.page as string) || "home";

    const [config, setConfig] = useState<PageConfig | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let mounted = true;
        setLoading(true);
        setConfig(null);
        (async () => {
            try {
                const cfg = await withAuth(async (auth) => getPageConfigAction(auth, pageName || undefined));
                if (mounted) setConfig(cfg ?? null);
            } catch (err) {
                if (mounted) setConfig(null);
            } finally {
                if (mounted) setLoading(false);
            }
        })();
        return () => {
            mounted = false;
        };
    }, [pageName, withAuth]);

    if (!loading && !config) return <PageNotFound pageName={pageName} />;

    return <DashboardLayoutTemplate config={config} pageName={pageName} isLoading={loading} />;
}
