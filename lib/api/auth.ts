import { NextRequest } from "next/server";

export function requireBearerAuth(req: NextRequest) {
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) return null;
    return authHeader.split(" ")[1];
}
