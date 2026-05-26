
"use client"

import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { createHomePageAction } from "@/app/actions/pageConfigs";
import useAuth from "@/context/useAuth";


type PageNotFoundProps = {
	pageName?: string;
};

export default function PageNotFound({ pageName }: PageNotFoundProps) {
	const { logout, withAuth } = useAuth();
	const navigate = useNavigate();
	const isHomePage = String(pageName ?? "").trim().toLowerCase() === "home";
	const [creatingHomePage, setCreatingHomePage] = React.useState(false);

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
		<main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
			<div style={{ textAlign: "center", padding: 24, maxWidth: 560 }}>
				<h1 style={{ fontSize: 28, margin: 0, marginBottom: 8 }}>Page not found</h1>
				<p style={{ color: "#666", marginBottom: 20 }}>We couldn't find the page you're looking for.</p>

				<div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
					{isHomePage ? (
						<>
							<button
								onClick={handleCreateHomePage}
								disabled={creatingHomePage}
								style={{
									padding: "10px 16px",
									background: "#0b5fff",
									color: "#fff",
									border: "1px solid #0b5fff",
									borderRadius: 6,
									cursor: creatingHomePage ? "wait" : "pointer",
									opacity: creatingHomePage ? 0.8 : 1
								}}
							>
								{creatingHomePage ? "Creating..." : "Create Home Page"}
							</button>

							<Link
								to="/migrate"
								style={{
									display: "inline-block",
									padding: "10px 16px",
									background: "transparent",
									color: "#0b5fff",
									border: "1px solid #0b5fff",
									borderRadius: 6,
									textDecoration: "none"
								}}
							>
								Go to Migrate
							</Link>
						</>
					) : (
						<Link
							to="/"
							style={{
								display: "inline-block",
								padding: "10px 16px",
								background: "#0b5fff",
								color: "#fff",
								borderRadius: 6,
								textDecoration: "none"
							}}
						>
							Go to Home
						</Link>
					)}

					<button onClick={handleLogout} style={{
						padding: "10px 16px",
						background: "transparent",
						border: "1px solid #ccc",
						borderRadius: 6,
						cursor: "pointer"
					}}>
						Logout
					</button>
				</div>
			</div>
		</main>
	);
}

