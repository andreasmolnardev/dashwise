import { useNavigate } from "react-router-dom";
import { useEffect } from "react";

export default function SettingsRedirect() {
    const navigate = useNavigate();

    useEffect(() => {
        navigate("/settings/appearance", { replace: true });
    }, [navigate]);

    return null;

}