"use client";
import { useNavigate } from "react-router-dom"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import config from "@/lib/config"
import { useEffect } from "react"
import { useQuery } from "@tanstack/react-query"
import { getAppConfigAction } from '@/lib/apiClient';
import { validateAuthTokenAction } from '@/lib/apiClient';
import { queryKeys } from "@/lib/queryClient";

export default function AuthWelcomeFormComponent() {
    const navigate = useNavigate();
    const appConfigQuery = useQuery({ queryKey: queryKeys.appConfig, queryFn: getAppConfigAction });
    const enableSSO = appConfigQuery.data?.enableSSO ?? false;

    useEffect(() => {
        const validateAuth = async () => {
            const loginToken = new URLSearchParams(window.location.search).get("loginToken");
            const token = loginToken || localStorage.getItem('pb_token');
            if (!token) return;

                try {
                    const result = await validateAuthTokenAction({ token });
                    localStorage.setItem("pb_token", result.token || token);
                    localStorage.setItem("pb_user", JSON.stringify(result.user));
                    navigate("/home", { replace: true });
                } catch (err) {
                    // ignore
                }
        };

        validateAuth();
    }, [navigate]);

    return (
        <Card className="w-full max-w-sm frosted text-foreground">
            <CardHeader>
                <CardTitle>Welcome to {config.instance_name || "Dashwise"}</CardTitle>
                <CardDescription className="text-muted-foreground">
                    Choose how you’d like to sign in.
                </CardDescription>
            </CardHeader>

            <CardContent className="flex flex-col gap-3">
                {(enableSSO === true) && (
                    <Button className="w-full" asChild>
                        <a href="/api/v1/auth/sso">Continue with SSO</a>
                    </Button>
                )}

                <Button
                    className="w-full"
                    variant={enableSSO === true ? "outline" : "default"}
                    onClick={() => navigate("/auth/login")}
                >
                    Login
                </Button>
                <Button variant="outline" className="w-full" onClick={() => navigate("/auth/signup")}>
                    Sign Up
                </Button>
            </CardContent>
        </Card>
    )
}
