import { useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useNavigate } from "react-router-dom";

export const Route = createFileRoute("/_authenticated/links/")({ component: LinksRedirectPage });

export default function LinksRedirectPage() {
	const navigate = useNavigate();

	useEffect(() => {
		navigate("/links/home", { replace: true });
	}, [navigate]);

	return null;
}
