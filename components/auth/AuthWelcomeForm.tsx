"use client";
import { useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import config from "@/lib/config"
import { useEffect } from "react"

export default function AuthWelcomeFormComponent() {
    const router = useRouter()
    console.log(config.enableSSO)
    //on load: check for existing auth, validate using /api/v1/auth/validate-auth endpoint if returned success to /home
    useEffect(() => {
        const validateAuth = async () => {
            const token = localStorage.getItem('pb_token');
            if (!token) return;

            try {
                const res = await fetch("/api/v1/auth/validate-auth", {
                    method: "POST",
                    headers: { Authorization: `Bearer ${token}` },
                });

                if (res.ok) {
                    router.push("/home");
                } else {
                    return;
                }
            } catch (err) {
                console.error("Auth validation failed:", err);
            }
        };

        validateAuth();
    }, [router]);

    return (
        <Card className="w-full max-w-sm frosted text-(--text-primary)">
            <CardHeader>
                <CardTitle>Welcome to Dashwise</CardTitle>
                <CardDescription className="text-(--text-primary/80)">
                    Choose how you’d like to sign in.
                </CardDescription>
            </CardHeader>

            <CardContent className="flex flex-col gap-3">
                {config.enableSSO && (
                    <Button className="w-full" onClick={() => router.push("/api/v1/auth/sso")}>
                        Continue with SSO
                    </Button>
                )}

                <Button
                    className="w-full"
                    variant={config.enableSSO ? "outline" : "default"}
                    onClick={() => router.push("/auth/login")}
                >
                    Login
                </Button>
                <Button variant="outline" className="w-full" onClick={() => router.push("/auth/signup")}>
                    Sign Up
                </Button>
            </CardContent>
        </Card>
    )
}
