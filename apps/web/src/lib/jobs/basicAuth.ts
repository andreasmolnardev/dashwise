import { Buffer } from "buffer";
import { NextRequest, NextResponse } from "next/server";

const BASIC_AUTH_REALM = "Basic realm=\"dashwise-jobs\"";

function createUnauthorizedResponse() {
	return NextResponse.json(
		{ status: "error", message: "Unauthorized" },
		{ status: 401, headers: { "WWW-Authenticate": BASIC_AUTH_REALM } }
	);
}

export function enforceJobsBasicAuth(req: NextRequest) {
	const env = import.meta.env;
	const header = req.headers.get("authorization") ?? "";
	if (!header.toLowerCase().startsWith("basic ")) {
		return createUnauthorizedResponse();
	}

	const encoded = header.slice(6).trim();
	if (!encoded) {
		return createUnauthorizedResponse();
	}

	let decoded: string;
	try {
		decoded = Buffer.from(encoded, "base64").toString("utf-8");
	} catch (error) {
		console.warn("Jobs auth decoding failed", error);
		return createUnauthorizedResponse();
	}

	const [email, password] = decoded.split(":", 2);
	const expectedEmail = env.PB_ADMIN_EMAIL;
	const expectedPassword = env.PB_ADMIN_PASSWORD;

	if (!expectedEmail || !expectedPassword) {
		console.warn("Missing job auth credentials in environment");
		return createUnauthorizedResponse();
	}

	if (email !== expectedEmail || password !== expectedPassword) {
		return createUnauthorizedResponse();
	}

	return null;
}