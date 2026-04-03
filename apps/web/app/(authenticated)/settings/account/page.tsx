"use client";

import React, { useState } from "react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Icon } from "@iconify-icon/react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ChangePasswordRequest } from "@/app/actions/auth";
import { useRouter } from "next/navigation";
import { changePasswordAction, deleteAccountAction } from "@/app/actions/auth";
import { DialogDescription } from "@radix-ui/react-dialog";
import ExportConfigDialog from "@/components/settings/ExportConfigDialog";
import { usePageConfig } from "@/hooks/usePageConfig";
import useAuth from "@/context/useAuth";
import ImportConfigDialog from "@/components/settings/ImportConfigDialog";

export default function AccountSettingsPage() {
  const { config } = usePageConfig();
  const router = useRouter();
  const { user, token, setAuth, logout } = useAuth();
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteTotp, setDeleteTotp] = useState("");
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleChangePasswordSubmit = async (
    e: React.FormEvent<HTMLFormElement>,
  ) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!oldPassword || !newPassword || !confirmPassword) {
      setError("All fields are required");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New passwords do not match");
      return;
    }
    if (newPassword.length < 8) {
      setError("New password should be at least 8 characters");
      return;
    }

    setLoading(true);
    try {
      const payload = {
        oldPassword,
        newPassword,
        confirmPassword,
      } satisfies ChangePasswordRequest;

      try {
        const body: any = await changePasswordAction({ token }, payload);
        setSuccess(body.message || "Password changed successfully");
        setOldPassword("");
        setNewPassword("");
        setConfirmPassword("");
        if (body.token) setAuth(user, body.token);
        setTimeout(() => {
          setSuccess(null);
        }, 900);
      } catch (err: any) {
        setError(
          err?.body?.error ?? err?.message ?? "Failed to change password",
        );
      }
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message || "Network error");
      } else {
        setError("Network error");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleLogoutSubmit = async () => {
    logout();
    router.push("/auth/login");
  };

  const handleDeleteAccountSubmit = async (
    e: React.FormEvent<HTMLFormElement>,
  ) => {
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

    if (deleteTotp) payload.totp = deleteTotp;

    setDeleteLoading(true);

    try {
      await deleteAccountAction({ token }, payload);
      logout();
      router.push("/auth/login");
    } catch (err: any) {
      setDeleteError(err?.message ?? "Failed to delete account");
    } finally {
      setDeleteLoading(false);
    }
  };

  return (
    <>
      <h1 className="text-3xl font-semibold mb-4">Account</h1>

      <div className="content grid grid-cols-[auto_1fr_auto] font-medium gap-2 items-center">
        <section className="frosted flex rounded-lg justify-center col-span-full p-2 items-center gap-6">
          <Icon icon="fa6-solid:circle-user" className="text-4xl" />
          <span>{user?.name ?? "Lorem ipsum"}</span>
        </section>

        <h2 className="text-xl col-span-full">Authentication</h2>

        <Dialog>
          <DialogTrigger className="grid grid-cols-subgrid border border-transparent hover-frosted items-center col-span-full p-1.5 rounded-md">
            <Icon icon="fa6-solid:key" />
            <p className="text-left">Change password</p>
            <Icon icon="fa6-solid:caret-right" />
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
                <Label htmlFor="confirm-new-password">
                  Repeat new password
                </Label>
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
          <Icon icon="fa6-solid:vault" />
          <p>Multi-factor Authentication</p>
          <Icon icon="fa6-solid:caret-right" />
        </div>

        <Dialog>
          <DialogTrigger className="grid grid-cols-subgrid border border-transparent hover-frosted items-center col-span-full p-1.5 rounded-md">
            <Icon icon="fa6-solid:right-to-bracket" />
            <p className="text-left">Log out</p>
            <Icon icon="fa6-solid:caret-right" />
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
        <ExportConfigDialog jsonString={JSON.stringify(config)} />

        <h2 className="text-xl col-span-full">Other</h2>
        <Dialog>
          <DialogTrigger className="grid grid-cols-subgrid border border-transparent hover-frosted items-center col-span-full p-1.5 rounded-md">
            <Icon icon="fa6-solid:trash" />
            <p className="text-left">Delete account</p>
            <Icon icon="fa6-solid:caret-right" />
          </DialogTrigger>

          <DialogContent className="frosted text-foreground">
            <DialogHeader>
              <DialogTitle>Delete account</DialogTitle>
              <DialogDescription>
                This is irreversible. You will need to re-create your account if
                you proceed.
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
                  <Button
                    variant="outline"
                    type="button"
                    disabled={deleteLoading}
                  >
                    Cancel
                  </Button>
                </DialogClose>
                <Button
                  variant="destructive"
                  type="submit"
                  disabled={deleteLoading}
                >
                  {deleteLoading ? "Deleting..." : "Delete account"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </>
  );
}
