import { useNavigate } from "react-router-dom";
import { useEffect } from "react";

export default function NotificationsRedirect() {
    const navigate = useNavigate();

    useEffect(() => {
        navigate("/notifications/inbox", { replace: true });
    }, [navigate]);

    return null;

}