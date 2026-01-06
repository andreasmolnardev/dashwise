"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome"
import { faCircleCheck, faExclamationTriangle } from "@fortawesome/free-solid-svg-icons"
import { setTimeout } from "timers"

export default function SignupCard() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const [enableSSO, setEnableSSO] = useState<boolean | null>(null);

  //on load: check for existing auth, validate using /api/v1/auth/validate-auth endpoint if returned success to /home
  useEffect(() => {
    // Fetch runtime config (e.g. enableSSO)
    fetch("/api/v1/appConfig")
      .then(res => res.json())
      .then(data => setEnableSSO(data.enableSSO ?? false))
      .catch(() => setEnableSSO(false));

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!email || !password || !confirmPassword) {
      setError("All fields are required")
      return
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match")
      return
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters")
      return
    }

    setLoading(true)
    try {
      const res = await fetch("/api/v1/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          _name: name,
          email,
          password,
          passwordConfirm: confirmPassword,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || "Signup failed")
      } else {
        setSuccess("Redirecting to login...")

        setTimeout(() => {
          // Clear the form fields
          setName("")
          setEmail("")
          setPassword("")
          setConfirmPassword("")

          router.push("/auth/login")
        }, 2000)
      }



    } catch (err) {
      console.error("Signup request failed:", err)
      setError("Network error")
    } finally {
      setLoading(false)
    }
  }


  return (
    <Card className="w-full max-w-sm frosted text-(--text-primary) backdrop-saturate-90 backdrop-brightness-90">
      <CardHeader>
        <CardTitle>Welcome to Dashwise!</CardTitle>
        <CardDescription>
          Let's get started by creating an account.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          {error && (
            <Alert variant="destructive">
              <FontAwesomeIcon icon={faExclamationTriangle}></FontAwesomeIcon>
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {success && (
            <Alert>
              <FontAwesomeIcon icon={faCircleCheck}></FontAwesomeIcon>
              <AlertTitle>Success!</AlertTitle>
              <AlertDescription>{success}</AlertDescription>
            </Alert>
          )}

          <div className="grid gap-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              type="text"
              placeholder="John Doe"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="me@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              placeholder="*********"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="confirm-password">Confirm Password</Label>
            <Input
              id="confirm-password"
              type="password"
              placeholder="Re-enter your password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
          </div>

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Creating account..." : "Create Account"}
          </Button>
        </form>
      </CardContent>
      <CardFooter className="flex-col gap-2">
        <Button variant="outline" className="w-full">
          <Link href="/auth/login">Login instead</Link>
        </Button>
      </CardFooter>
    </Card>
  )
}
