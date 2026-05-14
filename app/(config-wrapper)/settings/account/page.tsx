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
import { ChangePasswordRequest } from "@/packages/sdk/types/auth/change-password"
import { useRouter } from "next/navigation"
import { postAuthChangePassword } from "@/lib/apiClient";
import { DialogDescription } from "@radix-ui/react-dialog"
import ExportConfigDialog from "@/components/settings/ExportConfigDialog"
import { useConfig } from "@/context/ConfigContext"
import useAuth from "@/context/useAuth"
import ImportConfigDialog from "@/components/settings/ImportConfigDialog.tsx"

export default function AccountSettingsPage() {
 const { config } = useConfig();
  const router = useRouter();
  const { user, token, setAuth, logout } = useAuth();
  const [oldPassword, setOldPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [deletePassword, setDeletePassword] = useState("")
  const [deleteTotp, setDeleteTotp] = useState("")
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

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
      // token from auth hook

      const payload = {
        oldPassword,
        newPassword,
        confirmPassword,
      } satisfies ChangePasswordRequest;

      try {
        const body: any = await postAuthChangePassword(payload, { token });
        setSuccess(body.message || "Password changed successfully");
        setOldPassword("");
        setNewPassword("");
        setConfirmPassword("");
        if (body.token) setAuth(user, body.token);
        setTimeout(() => {
          setSuccess(null);
        }, 900);
      } catch (err: any) {
        setError(err?.body?.error ?? err?.message ?? "Failed to change password");
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
    logout();
    router.push('/auth/login');
  }

  const handleDeleteAccountSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setDeleteError(null);
    if (!user) {
      setDeleteError("Unable to determine your account details");
      return;
    }
    if (!deletePassword) {
      setDeleteError("Password is required to delete your account");
      return;
    }

    const payload: { email: string; password: string; totp?: string } = {
      email: user.email ?? user.username ?? "",
      password: deletePassword,
    };

    if (!payload.email) {
      setDeleteError("Missing email address on your profile");
      return;
    }

    if (deleteTotp) {
      payload.totp = deleteTotp;
    }

    setDeleteLoading(true);

    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      const response = await fetch("/api/v1/auth/delete-account", {
        method: "DELETE",
        headers,
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? response.statusText ?? "Failed to delete account");
      }

      logout();
      router.push('/auth/login');
    } catch (err: any) {
      setDeleteError(err?.message ?? "Failed to delete account");
    } finally {
      setDeleteLoading(false);
    }
  }

  return (
    <>
      <h1 className="text-3xl font-semibold mb-4">Account</h1>

      <div className="content grid grid-cols-[auto_1fr_auto] font-medium gap-2 items-center">
        <section className="frosted flex rounded-lg justify-center col-span-full p-2 items-center gap-6">
          <FontAwesomeIcon icon={faCircleUser} className="text-4xl" />
          <span>{user?.name ?? 'Lorem ipsum'}</span>
        </section>

        <h2 className="text-xl col-span-full">Authentication</h2>

        <Dialog>
          <DialogTrigger className="grid grid-cols-subgrid border border-transparent hover-frosted items-center col-span-full p-1.5 rounded-md">
            <FontAwesomeIcon icon={faKey} />
            <p className="text-left">Change password</p>
            <FontAwesomeIcon icon={faCaretRight} />
          </DialogTrigger>

          <DialogContent className="frosted text-foreground">
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

          <DialogContent className="frosted text-foreground">
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
        <Dialog>
          <DialogTrigger className="grid grid-cols-subgrid border border-transparent hover-frosted items-center col-span-full p-1.5 rounded-md">
            <FontAwesomeIcon icon={faTrash} />
            <p className="text-left">Delete account</p>
            <FontAwesomeIcon icon={faCaretRight} />
          </DialogTrigger>

          <DialogContent className="frosted text-foreground">
            <DialogHeader>
              <DialogTitle>Delete account</DialogTitle>
              <DialogDescription>
                This is irreversible. You will need to re-create your account if you proceed.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleDeleteAccountSubmit} className="grid gap-4">
              {deleteError && (
                <Alert className="mb-2" variant="destructive">
                  <AlertTitle>Error</AlertTitle>
                  <AlertDescription>{deleteError}</AlertDescription>
                </Alert>
              )}

              <div className="grid gap-3">
                <Label htmlFor="delete-password">Password</Label>
                <Input
                  id="delete-password"
                  name="deletePassword"
                  type="password"
                  placeholder="********"
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  disabled={deleteLoading}
                  autoComplete="current-password"
                />
              </div>

              <div className="grid gap-3">
                <Label htmlFor="delete-totp">TOTP code (if enabled)</Label>
                <Input
                  id="delete-totp"
                  name="deleteTotp"
                  type="text"
                  placeholder="123456"
                  value={deleteTotp}
                  onChange={(e) => setDeleteTotp(e.target.value)}
                  disabled={deleteLoading}
                  autoComplete="one-time-code"
                />
              </div>

              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline" type="button" disabled={deleteLoading}>
                    Cancel
                  </Button>
                </DialogClose>
                <Button variant="destructive" type="submit" disabled={deleteLoading}>
                  {deleteLoading ? "Deleting..." : "Delete account"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </>
  )
}
