"use client";

import React from "react";
import { useNavigate } from "react-router-dom";
import { Link } from "@tanstack/react-router";
import { createHomePageAction, validateAuthTokenAction } from '@/lib/apiClient';
import useAuth from "@/context/useAuth";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Button } from "../ui/button";

type PageNotFoundProps = {
	pageName?: string;
};

export default function PageNotFound({ pageName }: PageNotFoundProps) {
	const { token, logout, withAuth, withAuthRedirect, redirectToLogin } = useAuth();
	const navigate = useNavigate();
	const isHomePage = String(pageName ?? "").trim().toLowerCase() === "home";
	const [creatingHomePage, setCreatingHomePage] = React.useState(false);

	React.useEffect(() => {
		if (!token) {
			redirectToLogin();
			return;
		}

		let cancelled = false;

		const checkAuth = async () => {
			try {
				await withAuthRedirect(validateAuthTokenAction);
			} catch {
				if (cancelled) return;
			}
		};

		checkAuth();

		return () => {
			cancelled = true;
		};
	}, [redirectToLogin, token, withAuthRedirect]);

	const handleLogout = () => {
		try {
			logout();
		} finally {
			navigate("/");
		}
	};

	const handleCreateHomePage = async () => {
		setCreatingHomePage(true);
		try {
			await withAuth((auth) => createHomePageAction(auth));
			window.location.reload();
		} finally {
			setCreatingHomePage(false);
		}
	};

	return (
		<main
			style={{
				minHeight: "100vh",
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
			}}
		>
			<Card className="w-full max-w-lg text-center frosted text-foreground backdrop-saturate-90 backdrop-brightness-90">
				<CardHeader>
					<CardTitle className="text-2xl font-bold mb-2">
						Page not found
					</CardTitle>
					<CardDescription>
						We couldn't find the page you're looking for. <br />
						{" "}
						Please contact your admin if the error persists. <br />
						{" "}
						Or if you're upgrading from an older versions run
						migrations first.
					</CardDescription>
				</CardHeader>
				<CardFooter className="flex flex-col items-center gap-4">
					<div
						style={{
							display: "flex",
							gap: 12,
							justifyContent: "center",
							flexWrap: "wrap",
						}}
					>
						{isHomePage
							? (
								<>
									<Button
										onClick={handleCreateHomePage}
										disabled={creatingHomePage}
									>
										{creatingHomePage
											? "Creating..."
											: "Create Home Page"}
									</Button>

									<Link
										to="/migrate"
										style={{
											display: "inline-block",
											padding: "10px 16px",
											background: "transparent",
											color: "#0b5fff",
											border: "1px solid #0b5fff",
											borderRadius: 6,
											textDecoration: "none",
										}}
									>
										Go to Migrate
									</Link>
								</>
							)
							: (
								<Link to="/">
									<Button>
										Go to Home
									</Button>
								</Link>
							)}
						<Button onClick={handleLogout} variant="outline">
							Logout
						</Button>
					</div>
				</CardFooter>
			</Card>
		</main>
	);
}
