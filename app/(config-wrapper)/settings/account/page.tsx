"use client"

import React, { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogClose,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import {
  faCaretRight,
  faCircleUser,
  faKey,
  faVault,
  faRightToBracket,
  faUpload,
  faTrash,
} from "@fortawesome/free-solid-svg-icons"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome"
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert"
import { ChangePasswordError, ChangePasswordRequest, ChangePasswordSuccess } from "@/app/api/v1/auth/change-password/route"
import { useRouter } from "next/navigation"
import { DialogDescription } from "@radix-ui/react-dialog"
import ExportConfigDialog from "@/components/settings/ExportConfigDialog"
import { useConfig } from "@/context/ConfigContext"
import ImportConfigDialog from "@/components/settings/ImportConfigDialog.tsx"

export default function AccountSettingsPage() {
 const { config } = useConfig();
  const router = useRouter();
  const [oldPassword, setOldPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const handleChangePasswordSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)
    setSuccess(null)

    if (!oldPassword || !newPassword || !confirmPassword) {
      setError("All fields are required")
      return
    }
    if (newPassword !== confirmPassword) {
      setError("New passwords do not match")
      return
    }
    if (newPassword.length < 8) {
      setError("New password should be at least 8 characters")
      return
    }

    setLoading(true)
    try {
      const token = localStorage.getItem("pb_token");

      const payload = {
        oldPassword,
        newPassword,
        confirmPassword,
      } satisfies ChangePasswordRequest;

      const res = await fetch("/api/v1/auth/change-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body: ChangePasswordError = await res.json()
        setError(body.error || "Failed to change password");
      } else {
        const body: ChangePasswordSuccess = await res.json()
        setSuccess(body.message || "Password changed successfully");
        setOldPassword("");
        setNewPassword("");
        setConfirmPassword("");
        if (body.token) localStorage.setItem("pb_token", body.token);
        setTimeout(() => {
          setSuccess(null);
        }, 900);
      }
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message || "Network error")
      } else {
        setError("Network error")
      }
    } finally {
      setLoading(false)
    }
  }

  const handleLogoutSubmit = async () => {
    localStorage.removeItem('pb_token');
    localStorage.removeItem('pb_user');
    router.push('/auth/login');
  }

  return (
    <>
      <h1 className="text-3xl font-semibold mb-4">Account</h1>

      <div className="content grid grid-cols-[auto_1fr_auto] font-medium gap-2 items-center">
        <section className="frosted flex rounded-lg justify-center col-span-full p-2 items-center gap-6">
          <FontAwesomeIcon icon={faCircleUser} className="text-4xl" />
          <span>Lorem, ipsum.</span>
        </section>

        <h2 className="text-xl col-span-full">Authentication</h2>

        <Dialog>
          <DialogTrigger className="grid grid-cols-subgrid border border-transparent hover-frosted items-center col-span-full p-1.5 rounded-md">
            <FontAwesomeIcon icon={faKey} />
            <p className="text-left">Change password</p>
            <FontAwesomeIcon icon={faCaretRight} />
          </DialogTrigger>

          <DialogContent className="frosted text-(--text-primary)">
            <DialogHeader>
              <DialogTitle>Change password</DialogTitle>
            </DialogHeader>

            <form onSubmit={handleChangePasswordSubmit} className="grid gap-4">
              {error && (
                <Alert className="mb-2" variant="destructive">
                  <AlertTitle>Error</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              {success && (
                <Alert className="mb-2">
                  <AlertTitle>Success</AlertTitle>
                  <AlertDescription>{success}</AlertDescription>
                </Alert>
              )}

              <div className="grid gap-3">
                <Label htmlFor="old-password">Old password</Label>
                <Input
                  id="old-password"
                  name="oldPassword"
                  type="password"
                  placeholder="********"
                  value={oldPassword}
                  onChange={(e) => setOldPassword(e.target.value)}
                  disabled={loading}
                  autoComplete="current-password"
                />
              </div>

              <div className="grid gap-3">
                <Label htmlFor="new-password">New password</Label>
                <Input
                  id="new-password"
                  name="newPassword"
                  type="password"
                  placeholder="********"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  disabled={loading}
                  autoComplete="new-password"
                />
              </div>

              <div className="grid gap-3">
                <Label htmlFor="confirm-new-password">Repeat new password</Label>
                <Input
                  id="confirm-new-password"
                  name="confirmPassword"
                  type="password"
                  placeholder="********"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={loading}
                  autoComplete="new-password"
                />
              </div>

              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline" type="button" disabled={loading}>
                    Cancel
                  </Button>
                </DialogClose>
                <Button type="submit" disabled={loading}>
                  {loading ? "Saving..." : "Save changes"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        <div className="grid grid-cols-subgrid border border-transparent hover-frosted items-center col-span-full p-1.5 rounded-md">
          <FontAwesomeIcon icon={faVault} />
          <p>Multi-factor Authentication</p>
          <FontAwesomeIcon icon={faCaretRight} />
        </div>

        <Dialog>
          <DialogTrigger className="grid grid-cols-subgrid border border-transparent hover-frosted items-center col-span-full p-1.5 rounded-md">
            <FontAwesomeIcon icon={faRightToBracket} />
            <p className="text-left">Log out</p>
            <FontAwesomeIcon icon={faCaretRight} />
          </DialogTrigger>

          <DialogContent className="frosted text-(--text-primary)">
            <DialogHeader>
              <DialogTitle>Confirm Logout</DialogTitle>
            </DialogHeader>
            <DialogDescription>
              You will have to log back in again to access your dashboard
            </DialogDescription>

            <form onSubmit={handleLogoutSubmit} className="grid gap-4">
              {error && (
                <Alert className="mb-2" variant="destructive">
                  <AlertTitle>Error</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              {success && (
                <Alert className="mb-2">
                  <AlertTitle>Success</AlertTitle>
                  <AlertDescription>{success}</AlertDescription>
                </Alert>
              )}


              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline" type="button" disabled={loading}>
                    Cancel
                  </Button>
                </DialogClose>
                <Button type="submit" disabled={loading}>
                  {loading ? "Logging out..." : "Log out"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        <h2 className="text-xl col-span-full">Config</h2>
        <ImportConfigDialog />
        <ExportConfigDialog jsonString={JSON.stringify(config)}/>

        <h2 className="text-xl col-span-full">Other</h2>
        <div className="grid grid-cols-subgrid border border-transparent hover-frosted items-center col-span-full p-1.5 rounded-md">
          <FontAwesomeIcon icon={faTrash} />
          <p>Delete account</p>
          <FontAwesomeIcon icon={faCaretRight} />
        </div>
      </div>
    </>
  )
}
