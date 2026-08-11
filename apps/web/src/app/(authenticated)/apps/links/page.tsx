import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

export default function LinksRedirectPage() {
	const navigate = useNavigate();

	useEffect(() => {
		navigate("/apps/links/home", { replace: true });
	}, [navigate]);

	return null;
}
