"use client"

import { Link, useNavigate } from "react-router-dom"
import { useEffect, useRef, useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { getAppConfigAction } from '@/lib/apiClient';
import { deviceCodeSocketUrl, loginUserAction, validateAuthTokenAction } from '@/lib/apiClient';
import useAuth from "@/context/useAuth"
import { useNotification } from "@/context/NotificationContext"
import { queryKeys } from "@/lib/queryClient";
import { setClientSessionId } from "@/lib/session";

import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

export default function LoginCard() {
  const navigate = useNavigate()
  const { token, setAuth } = useAuth();
  const { notify } = useNotification();
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [deviceCode, setDeviceCode] = useState<string | null>(null)
  const deviceSocket = useRef<WebSocket | null>(null)
  const appConfigQuery = useQuery({ queryKey: queryKeys.appConfig, queryFn: getAppConfigAction });
  const enableSSO = appConfigQuery.data?.enableSSO ?? false;
  const loginMutation = useMutation({ mutationFn: loginUserAction });

  useEffect(() => {
    let socket: WebSocket | null = null;
    let disposed = false;

    // React Strict Mode replays effects in development. Defer the connection
    // one task so the replay cleanup can cancel before opening a socket that
    // would immediately be closed while its handshake is still in progress.
    const connectTimer = window.setTimeout(() => {
      if (disposed) return;
      socket = new WebSocket(deviceCodeSocketUrl());
      deviceSocket.current = socket;
      socket.onmessage = (event) => {
        if (disposed) return;
        const message = JSON.parse(event.data);
        if (message.type === "device-code") {
          setDeviceCode(message.code);
          socket?.send(JSON.stringify({ type: "authenticate", requestId: message.requestId, secret: message.secret }));
        }
        if (message.type === "approved") {
          setClientSessionId(message.sessionId);
          setAuth(message.user, message.token);
          notify({ title: "Device approved", description: "Redirecting...", variant: "success" });
          setTimeout(() => navigate("/home"), 500);
        }
        if (message.type === "error") {
          notify({ title: "Device login failed", description: message.message, variant: "error" });
        }
      };
      socket.onerror = () => {
        if (!disposed) {
          notify({ title: "Device login failed", description: "Unable to start device login", variant: "error" });
        }
      };
    }, 0);

    return () => {
      disposed = true;
      window.clearTimeout(connectTimer);
      if (deviceSocket.current === socket) deviceSocket.current = null;
      if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
    };
  }, [navigate, notify, setAuth]);


  //on load: check for existing auth, validate using /api/v1/auth/validate-auth endpoint if returned success to /home
   useEffect(() => {
    const validateAuth = async () => {
      const tokenToCheck = token;
      if (!tokenToCheck) return;

      try {
        try {
          await validateAuthTokenAction({ token: tokenToCheck });
          navigate("/home");
        } catch (e) {
          // ignore
        }
      } catch (err) {
        console.error("Auth validation failed:", err);
      }
    };

    validateAuth();
  }, [navigate, token]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    try {
      const { token: newToken, sessionId, user } = await loginMutation.mutateAsync({ email, password }) as { token: string; sessionId: string; user: import("@dashwise/types/sdk").AuthUserRecord };
      setClientSessionId(sessionId);
      setAuth(user, newToken);

      notify({ title: "Login successful", description: "Redirecting to home...", variant: "success" });
      setTimeout(() => {
        setEmail("");
        setPassword("");
        navigate("/home");
      }, 2000);
    } catch (err: any) {
      console.error(err);
      notify({ title: "Login failed", description: err?.message || "Login failed", variant: "error" });
    }
  }


  return (
    <Card className="w-full max-w-sm frosted text-foreground backdrop-saturate-90 backdrop-brightness-90">
      <CardHeader>
        <CardTitle>Welcome back to Dashwise!</CardTitle>
        <CardDescription className="text-muted-foreground">
          Login using your credentials below.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleLogin} className="flex flex-col gap-6">
          <div className="grid gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="m@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="frosted"
              required
            />
          </div>
          <div className="grid gap-2">
            <div className="flex items-center">
              <Label htmlFor="password">Password</Label>
              <Dialog>
                <DialogTrigger asChild>
                  <Button
                    variant="link"
                    type="button"
                    className="ml-auto inline-block h-auto p-0 text-sm underline-offset-4 hover:underline"
                  >
                    Forgot your password?
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-[425px] frosted text-foreground">
                  <DialogHeader>
                    <DialogTitle>Problems Authenticating?</DialogTitle>
                      <div>
                        <h3 className="font-semibold">If you're a user...</h3>
                        <p className="text-(--text-on-frosted)">Contact your admin.</p>
                      </div>
                      <div>
                        <h3 className="font-semibold">If you're an admin...</h3>
                        <p className="text-(--text-on-frosted)">
                          Go into pocketbase dashboard (authenticate using the env vars set for pocketbase container) and change login details for your user there.
                        </p>
                      </div>
                  </DialogHeader>
                </DialogContent>
              </Dialog>
            </div>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="frosted"
              required
            />
            <p className="text-sm text-muted-foreground">Or login using Device Code <strong>{deviceCode ?? "connecting..."}</strong></p>
          </div>

          <Button type="submit" className="w-full" disabled={loginMutation.isPending}>
            {loginMutation.isPending ? "Logging in..." : "Login"}
          </Button>
        </form>
      </CardContent>
      <CardFooter className="flex-col gap-2">
        <Button variant="outline" className="w-full frosted">
                    <Link to="/auth/signup">Sign up instead</Link>
        </Button>

        {(enableSSO === true)  && (
          <Button variant="outline" className="w-full frosted">
            <a href="/api/v1/auth/sso">Use SSO</a>
          </Button>
        )}

      </CardFooter>
    </Card>
  )
}
