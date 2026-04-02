"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { getAppConfigAction } from "@/app/actions/app";
import { loginUserAction, validateAuthTokenAction } from "@/app/actions/auth";
import useAuth from "@/context/useAuth"
import { useRouter } from "next/navigation"

import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Icon } from "@iconify-icon/react"

export default function LoginCard() {
  const router = useRouter()
  const { token, setAuth } = useAuth();
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [enableSSO, setEnableSSO] = useState<boolean | null>(null);


  //on load: check for existing auth, validate using /api/v1/auth/validate-auth endpoint if returned success to /home
   useEffect(() => {
    // Fetch runtime config (e.g. enableSSO)
    getAppConfigAction().then(data => setEnableSSO(data.enableSSO ?? false)).catch(() => setEnableSSO(false));

    const validateAuth = async () => {
      const tokenToCheck = token;
      if (!tokenToCheck) return;

      try {
        try {
          await validateAuthTokenAction({ token: tokenToCheck });
          router.push("/home");
        } catch (e) {
          // ignore
        }
      } catch (err) {
        console.error("Auth validation failed:", err);
      }
    };

    validateAuth();
  }, [router, token]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);

    try {
      const { token: newToken, user } = await loginUserAction({ email, password });
      setAuth(user, newToken);

      setSuccess("Login successful! Redirecting to home...");
      setTimeout(() => {
        setEmail("");
        setPassword("");
        router.push("/home");
      }, 2000);
    } catch (err: any) {
      console.error(err);
      setError(err?.message || "Login failed");
    } finally {
      setLoading(false);
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
          {error && (
            <Alert variant="destructive">
              <Icon icon="fa6-solid:triangle-exclamation" className="h-4 w-4" />
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {success && (
            <Alert>
              <Icon icon="fa6-solid:circle-check" className="h-4 w-4" />
              <AlertTitle>Success!</AlertTitle>
              <AlertDescription>{success}</AlertDescription>
            </Alert>
          )}

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
          </div>

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Logging in..." : "Login"}
          </Button>
        </form>
      </CardContent>
      <CardFooter className="flex-col gap-2">
        <Button variant="outline" className="w-full frosted">
          <Link href="/auth/signup">Sign up instead</Link>
        </Button>

        {(enableSSO === true)  && (
          <Button variant="outline" className="w-full frosted">
            <Link href="/api/v1/auth/sso">Use SSO</Link>
          </Button>
        )}

      </CardFooter>
    </Card>
  )
}