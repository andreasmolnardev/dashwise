
"use client"

import React from "react";
import { Link, useNavigate } from "react-router-dom";
import useAuth from "@/src/context/useAuth";

export default function PageNotFound() {
	const { logout } = useAuth();
	const navigate = useNavigate();

	const handleLogout = () => {
		try {
			logout();
		} finally {
			navigate("/");
		}
	};

	return (
		<main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
			<div style={{ textAlign: "center", padding: 24, maxWidth: 560 }}>
				<h1 style={{ fontSize: 28, margin: 0, marginBottom: 8 }}>Page not found</h1>
				<p style={{ color: "#666", marginBottom: 20 }}>We couldn't find the page you're looking for.</p>

				<div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
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

