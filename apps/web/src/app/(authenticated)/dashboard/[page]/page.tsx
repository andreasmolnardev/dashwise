
import useAuth from "@/context/useAuth";
import { useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { getPageConfigAction } from "@/lib/apiClient";
import PageNotFound from "@/components/errorPages/PageNotFound";
import DashboardLayoutTemplate from "@/components/dashboard/DashboardLayoutTemplate";
import type { PageConfig } from "@dashwise/types/sdk";

export default function DashboardPageFromConfig() {
    const params = useParams();
    const { withAuth } = useAuth();
    const pageName = (params?.page as string) || "home";

    const [pageState, setPageState] = useState<{
        pageName: string;
        config: PageConfig | null;
        loading: boolean;
    }>({ pageName, config: null, loading: true });

    useEffect(() => {
        let mounted = true;
        setPageState({ pageName, config: null, loading: true });
        (async () => {
            try {
                const cfg = await withAuth(async (auth) => getPageConfigAction(auth, pageName || undefined));
                if (mounted) setPageState({ pageName, config: cfg ?? null, loading: false });
            } catch (err) {
                if (mounted) setPageState({ pageName, config: null, loading: false });
            }
        })();
        return () => {
            mounted = false;
        };
    }, [pageName, withAuth]);

    const pageStateIsCurrent = pageState.pageName === pageName;
    const isLoading = !pageStateIsCurrent || pageState.loading;
    const config = pageStateIsCurrent ? pageState.config : null;

    if (!isLoading && !config) return <PageNotFound pageName={pageName} />;

    return <DashboardLayoutTemplate config={config} pageName={pageName} isLoading={isLoading} />;
}
