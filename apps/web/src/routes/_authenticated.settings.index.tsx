import { useNavigate } from "react-router-dom";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/_authenticated/settings/")({ component: SettingsRedirect });

export default function SettingsRedirect() {
    const navigate = useNavigate();

    useEffect(() => {
        navigate("/settings/appearance", { replace: true });
    }, [navigate]);

    return null;

}
