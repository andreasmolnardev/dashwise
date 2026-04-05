
import useAuth from "@/context/useAuth";
import { useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { getPageConfigAction } from "../../../actions/pageConfigs";
import PageNotFound from "@/components/errorPages/PageNotFound";
import DashboardLayoutTemplate from "@/components/dashboard/DashboardLayoutTemplate";

export default function DashboardPageFromConfig() {
    const params = useParams();
    const { withAuth } = useAuth();
    const pageName = (params?.page as string) || "home";

    const [config, setConfig] = useState<any | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let mounted = true;
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

    if (loading) return null;
    if (!config) return <PageNotFound pageName={pageName} />;

    return <DashboardLayoutTemplate config={config} pageName={pageName} />;
}
