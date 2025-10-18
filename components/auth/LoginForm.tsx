"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import pb from "@/lib/pb"

import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome"
import { faCircleCheck, faExclamationTriangle } from "@fortawesome/free-solid-svg-icons"
import config from "@/lib/config"

export default function LoginCard() {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

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

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);

    try {
      const res = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        const { error } = await res.json();
        throw new Error(error || "Login failed");
      }

      const { token, user } = await res.json();
      localStorage.setItem('pb_token', token);
      localStorage.setItem('pb_user', JSON.stringify(user));

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
    <Card className="w-full max-w-sm frosted text-(--text-primary) backdrop-saturate-90 backdrop-brightness-90">
      <CardHeader>
        <CardTitle>Welcome back to Dashwise!</CardTitle>
        <CardDescription className="text-(--text-primary/80)">
          Login using your credentials below.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleLogin} className="flex flex-col gap-6">
          {error && (
            <Alert variant="destructive">
              <FontAwesomeIcon icon={faExclamationTriangle} className="h-4 w-4" />
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {success && (
            <Alert>
              <FontAwesomeIcon icon={faCircleCheck} className="h-4 w-4" />
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
              <a
                href="#"
                className="ml-auto inline-block text-sm underline-offset-4 hover:underline"
              >
                Forgot your password?
              </a>
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

        {config.enableSSO && (
          <Button variant="outline" className="w-full frosted">
            <Link href="/auth/signup">Use SSO</Link>
          </Button>
        )}

      </CardFooter>
    </Card>
  )
}
