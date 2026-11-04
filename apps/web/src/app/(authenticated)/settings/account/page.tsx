
import React, { useEffect, useState } from "react";
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
import { ChangePasswordRequest } from '@/lib/apiClient';
import { useLocation, useNavigate } from "react-router-dom";
import { changePasswordAction, createAPICredentialAction, deleteAccountAction, listAPICredentialsAction, revokeAPICredentialAction, startAccountReauthenticationAction, type CreatedAPICredential } from '@/lib/apiClient';
import { approveDeviceCodeAction, cancelDeviceCodeAction, getCurrentSessionAction, listSessionsAction, lookupDeviceCodeAction, renameCurrentSessionAction, revokeSessionAction } from '@/lib/apiClient';
import { DialogDescription } from "@radix-ui/react-dialog";
import useAuth from "@/context/useAuth";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryClient";

const DEFAULT_SESSION_NAMES = new Set(["web browser"]);

export default function AccountSettingsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, token, setAuth, logout, withAuth } = useAuth();
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
  const [reauthNotice, setReauthNotice] = useState<string | null>(null);
  const [sessionName, setSessionName] = useState("");
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [isDeviceNameDialogOpen, setIsDeviceNameDialogOpen] = useState(false);
  const [isDeviceCodeDialogOpen, setIsDeviceCodeDialogOpen] = useState(false);
  const [deviceCode, setDeviceCode] = useState("");
  const [deviceRequest, setDeviceRequest] = useState<Awaited<ReturnType<typeof lookupDeviceCodeAction>> | null>(null);
  const [deviceCodeError, setDeviceCodeError] = useState<string | null>(null);
  const [deviceCodeLoading, setDeviceCodeLoading] = useState(false);
  const [apiCredentialName, setApiCredentialName] = useState("");
  const [apiCredentialExpiry, setApiCredentialExpiry] = useState(90);
  const [createdAPICredential, setCreatedAPICredential] = useState<CreatedAPICredential | null>(null);
  const [apiCredentialError, setAPICredentialError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  useEffect(() => {
    const reauthResult = new URLSearchParams(location.search).get("reauth");
    if (reauthResult === "success") setReauthNotice("Your identity provider confirmed your sign-in. Delete your account within 10 minutes to complete the request.");
    if (reauthResult === "failed") setReauthNotice("SSO reauthentication failed or was too old. Start again and complete sign-in with your identity provider.");
    if (reauthResult) navigate(location.pathname, { replace: true });
  }, [location.pathname, location.search, navigate]);
  const sessionsQuery = useQuery({ queryKey: ["auth", "sessions", token], enabled: Boolean(token), queryFn: () => withAuth(listSessionsAction) });
  const apiCredentialsQuery = useQuery({ queryKey: ["auth", "api-credentials", token], enabled: Boolean(token), queryFn: () => withAuth(listAPICredentialsAction) });
  const createAPICredentialMutation = useMutation({
    mutationFn: () => withAuth((auth) => createAPICredentialAction(auth, apiCredentialName, apiCredentialExpiry)),
    onSuccess: (created) => {
      setCreatedAPICredential(created);
      setApiCredentialName("");
      setAPICredentialError(null);
      void queryClient.invalidateQueries({ queryKey: ["auth", "api-credentials", token] });
    },
    onError: (cause) => setAPICredentialError(cause instanceof Error ? cause.message : "Could not create API credential"),
  });
  const revokeAPICredentialMutation = useMutation({
    mutationFn: (id: string) => withAuth((auth) => revokeAPICredentialAction(auth, id)),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["auth", "api-credentials", token] }),
    onError: (cause) => setAPICredentialError(cause instanceof Error ? cause.message : "Could not revoke API credential"),
  });
  const sessionQuery = useQuery({
    queryKey: queryKeys.auth.session(token),
    enabled: Boolean(token),
    retry: false,
    queryFn: () => withAuth(getCurrentSessionAction),
  });
  const sessionMutation = useMutation({
    mutationFn: (displayName: string) => withAuth((auth) => renameCurrentSessionAction(auth, displayName)),
    onSuccess: (session) => {
      setSessionName(session.displayName);
      setSessionError(null);
      queryClient.setQueryData(queryKeys.auth.session(token), session);
      setIsDeviceNameDialogOpen(false);
    },
  });

  useEffect(() => {
    setSessionName(sessionQuery.data?.displayName ?? "");
  }, [sessionQuery.data?.displayName]);

  const handleSessionNameSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedName = sessionName.trim();
    if (!normalizedName || normalizedName.length > 100) {
      setSessionError("device name must be between 1 and 100 characters");
      return;
    }
    setSessionError(null);
    sessionMutation.mutate(normalizedName, {
      onError: (cause) => setSessionError(cause instanceof Error ? cause.message : "failed to save device name"),
    });
  };

  const normalizedSessionDisplayName = sessionQuery.data?.displayName?.trim().toLowerCase();
  const needsDeviceName = !normalizedSessionDisplayName ||
    DEFAULT_SESSION_NAMES.has(normalizedSessionDisplayName);

  const handleDeviceCodeSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setDeviceCodeError(null); setDeviceCodeLoading(true);
    try { setDeviceRequest(await lookupDeviceCodeAction({ token }, deviceCode)); }
    catch (cause: any) { setDeviceCodeError(cause?.message ?? "Invalid or expired device code"); }
    finally { setDeviceCodeLoading(false); }
  };
  const approveDeviceCode = async () => {
    setDeviceCodeLoading(true); setDeviceCodeError(null);
    try { await approveDeviceCodeAction({ token }, deviceCode); setIsDeviceCodeDialogOpen(false); setDeviceCode(""); setDeviceRequest(null); }
    catch (cause: any) { setDeviceCodeError(cause?.message ?? "Unable to approve device"); }
    finally { setDeviceCodeLoading(false); }
  };
  const cancelDeviceCode = async () => {
    try { await cancelDeviceCodeAction({ token }, deviceCode); setIsDeviceCodeDialogOpen(false); setDeviceCode(""); setDeviceRequest(null); } catch (cause: any) { setDeviceCodeError(cause?.message ?? "Unable to cancel device"); }
  };

  const handleChangePasswordSubmit = async (
    e: React.FormEvent<HTMLFormElement>,
  ) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if ((!user?.externalOnly && !oldPassword) || !newPassword || !confirmPassword) {
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
    navigate("/auth/login");
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
    if (!user.externalOnly && !deletePassword) {
      setDeleteError("Password is required to delete your account");
      return;
    }

    const payload: { email: string; password: string; totp?: string } = {
      email: String(user.email ?? user.username ?? ""),
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
      navigate("/auth/login");
    } catch (err: any) {
      setDeleteError(err?.message ?? "Failed to delete account");
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleStartAccountReauthentication = async () => {
    setDeleteError(null);
    setReauthNotice(null);
    try {
      const authorizationUrl = await withAuth(startAccountReauthenticationAction);
      window.location.assign(authorizationUrl);
    } catch (err: any) {
      setDeleteError(err?.message ?? "Could not start SSO reauthentication");
    }
  };

  return (
    <>
      <h1 className="text-3xl font-semibold mb-4">Account</h1>
      {reauthNotice && (
        <Alert className="mb-4" variant={reauthNotice.startsWith("SSO reauthentication failed") ? "destructive" : undefined}>
          <AlertTitle>{reauthNotice.startsWith("SSO reauthentication failed") ? "SSO reauthentication failed" : "SSO reauthentication complete"}</AlertTitle>
          <AlertDescription>{reauthNotice}</AlertDescription>
        </Alert>
      )}

      <div className="content grid grid-cols-[auto_1fr_auto] font-medium gap-2 items-center">
        <section className="frosted flex rounded-lg justify-center col-span-full p-2 items-center gap-6">
          <Icon icon="fa6-solid:circle-user" className="text-4xl" />
          <div className="min-w-0">
            <p>{user?.name ?? "Lorem ipsum"}</p>
            <p className="text-sm font-normal text-muted-foreground">{sessionQuery.data?.displayName ?? (sessionQuery.isLoading ? "Loading session…" : "Current session")}</p>
          </div>
        </section>

        <h2 className="text-xl col-span-full">Authentication</h2>
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline" className="col-span-full justify-start">View Sessions</Button>
          </DialogTrigger>
          <DialogContent className="frosted text-foreground">
            <DialogHeader>
              <DialogTitle>Active sessions</DialogTitle>
              <DialogDescription>Review devices signed in to your account and revoke sessions you no longer use.</DialogDescription>
            </DialogHeader>
            <div className="grid max-h-[60vh] gap-2 overflow-y-auto">
              {sessionsQuery.isLoading && <p className="text-sm text-muted-foreground">Loading sessions…</p>}
              {sessionsQuery.isError && <p role="alert" className="text-sm text-red-300">Sessions could not be loaded.</p>}
              {sessionsQuery.data?.map((session) => <div key={session.sessionId} className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm"><span className="min-w-0 break-words">{session.displayName} · last used {new Date(session.lastSeenAt).toLocaleString()}</span><Button variant="ghost" size="sm" disabled={session.sessionId === sessionQuery.data?.sessionId} onClick={async () => { await withAuth((auth) => revokeSessionAction(auth, session.sessionId)); sessionsQuery.refetch(); }}>Revoke</Button></div>)}
              {sessionsQuery.isSuccess && sessionsQuery.data.length === 0 && <p className="text-sm text-muted-foreground">No active sessions found.</p>}
            </div>
          </DialogContent>
        </Dialog>

        <section className="frosted col-span-full rounded-lg p-4 grid gap-3">
          <div>
            <h3 className="text-lg font-semibold">External API credentials</h3>
            <p className="text-sm font-normal text-muted-foreground">Create read-only credentials for querying your resources. The token is shown once and expires automatically.</p>
          </div>
          {createdAPICredential && (
            <div role="alert" className="grid gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              <p>Copy this token now. Dashwise will not show it again.</p>
              <code className="break-all rounded bg-black/20 p-2">{createdAPICredential.token}</code>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={() => void navigator.clipboard.writeText(createdAPICredential.token)}>Copy token</Button>
                <Button type="button" variant="ghost" onClick={() => setCreatedAPICredential(null)}>Hide token</Button>
              </div>
            </div>
          )}
          <form className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_150px_auto]" onSubmit={(event) => { event.preventDefault(); setAPICredentialError(null); createAPICredentialMutation.mutate(); }}>
            <Input value={apiCredentialName} onChange={(event) => setApiCredentialName(event.target.value)} placeholder="Credential name" aria-label="Credential name" maxLength={80} required />
            <select className="frosted rounded-md border px-3 py-2 text-sm" value={apiCredentialExpiry} onChange={(event) => setApiCredentialExpiry(Number(event.target.value))} aria-label="Credential expiration">
              <option value={30}>Expires in 30 days</option>
              <option value={90}>Expires in 90 days</option>
              <option value={365}>Expires in 1 year</option>
            </select>
            <Button type="submit" disabled={createAPICredentialMutation.isPending || !apiCredentialName.trim()}>{createAPICredentialMutation.isPending ? "Creating…" : "Create credential"}</Button>
          </form>
          {apiCredentialError && <p role="alert" className="text-sm text-red-300">{apiCredentialError}</p>}
          {apiCredentialsQuery.isLoading && <p className="text-sm text-muted-foreground">Loading credentials…</p>}
          {apiCredentialsQuery.isError && <p role="alert" className="text-sm text-red-300">API credentials could not be loaded.</p>}
          {apiCredentialsQuery.data?.map((credential) => (
            <div key={credential.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm">
              <div className="min-w-0">
                <p className="font-medium">{credential.name} <code className="font-normal text-muted-foreground">{credential.prefix}…</code></p>
                <p className="font-normal text-muted-foreground">Read resources · expires {new Date(credential.expiresAt).toLocaleDateString()} · {credential.lastUsedAt ? `last used ${new Date(credential.lastUsedAt).toLocaleString()}` : "not used yet"}</p>
              </div>
              <Button type="button" variant="ghost" size="sm" disabled={revokeAPICredentialMutation.isPending} onClick={() => { if (window.confirm(`Revoke ${credential.name}? Clients using it will lose access.`)) revokeAPICredentialMutation.mutate(credential.id); }}>Revoke</Button>
            </div>
          ))}
          {apiCredentialsQuery.isSuccess && apiCredentialsQuery.data.length === 0 && <p className="text-sm font-normal text-muted-foreground">No API credentials created.</p>}
        </section>

        <Dialog
          open={isDeviceNameDialogOpen}
          onOpenChange={(open) => {
            setIsDeviceNameDialogOpen(open);
            if (open) {
              setSessionName(sessionQuery.data?.displayName ?? "");
              setSessionError(null);
            }
          }}
        >
          <DialogTrigger className="grid grid-cols-subgrid border border-transparent hover-frosted items-center col-span-full p-1.5 rounded-md">
            <Icon icon="fa6-solid:display" />
            <p className="text-left">
              Change Device Name
              {sessionQuery.isFetched && needsDeviceName && (
                <span
                  aria-hidden="true"
                  className="ml-2 inline-block h-2 w-2 rounded-full bg-primary align-middle"
                />
              )}
            </p>
            <Icon icon="fa6-solid:caret-right" />
          </DialogTrigger>

          <DialogContent className="frosted text-foreground">
            <DialogHeader>
              <DialogTitle>Change Device Name</DialogTitle>
              <DialogDescription>
                Set a name for this browser so you can recognize it elsewhere in Dashwise.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleSessionNameSubmit} className="grid gap-4">
              <div className="grid gap-3">
                <Label htmlFor="session-name">Device name</Label>
                <Input
                  id="session-name"
                  value={sessionName}
                  onChange={(event) => setSessionName(event.target.value)}
                  placeholder="Web browser"
                  maxLength={100}
                  disabled={sessionQuery.isLoading || sessionMutation.isPending}
                />
                {sessionError && <p className="text-sm text-red-300">{sessionError}</p>}
              </div>

              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline" type="button" disabled={sessionMutation.isPending}>
                    Cancel
                  </Button>
                </DialogClose>
                <Button
                  type="submit"
                  disabled={sessionQuery.isLoading || sessionMutation.isPending || !sessionName.trim()}
                >
                  {sessionMutation.isPending ? "Saving..." : "Save changes"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        <Dialog open={isDeviceCodeDialogOpen} onOpenChange={(open) => { setIsDeviceCodeDialogOpen(open); if (!open) { setDeviceRequest(null); setDeviceCodeError(null); } }}>
          <DialogTrigger className="grid grid-cols-subgrid border border-transparent hover-frosted items-center col-span-full p-1.5 rounded-md">
            <Icon icon="fa6-solid:mobile-screen-button" /><p className="text-left">Authenticate another session using Device Code</p><Icon icon="fa6-solid:caret-right" />
          </DialogTrigger>
          <DialogContent className="frosted text-foreground"><DialogHeader><DialogTitle>Authenticate another session using Device Code</DialogTitle><DialogDescription>Enter the code shown on the other browser. Verify its details before approving.</DialogDescription></DialogHeader>
            <form onSubmit={handleDeviceCodeSubmit} className="grid gap-4"><div className="grid gap-3"><Label htmlFor="device-code">Device code</Label><Input id="device-code" value={deviceCode} onChange={(e) => setDeviceCode(e.target.value.toUpperCase())} placeholder="ABC-DEF" maxLength={7} disabled={deviceCodeLoading || !!deviceRequest} />
              {deviceRequest && <div className="rounded-md border p-3 text-sm"><p><strong>Requested:</strong> {new Date(deviceRequest.createdAt).toLocaleString()}</p><p><strong>Browser:</strong> {deviceRequest.userAgent}</p><p><strong>IP:</strong> {deviceRequest.ip}</p></div>}{deviceCodeError && <p className="text-sm text-red-300">{deviceCodeError}</p>}</div><DialogFooter>{deviceRequest ? <><Button type="button" variant="outline" onClick={cancelDeviceCode}>Cancel</Button><Button type="button" onClick={approveDeviceCode} disabled={deviceCodeLoading}>{deviceCodeLoading ? "Approving..." : "Approve"}</Button></> : <><DialogClose asChild><Button type="button" variant="outline">Close</Button></DialogClose><Button type="submit" disabled={deviceCodeLoading || deviceCode.length < 7}>{deviceCodeLoading ? "Checking..." : "Continue"}</Button></>}</DialogFooter></form>
          </DialogContent>
        </Dialog>

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

              {user?.externalOnly ? (
                <p className="text-sm text-muted-foreground">Your account uses SSO. Set a password here if you also want to sign in with an email and password.</p>
              ) : (
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
              )}

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

              {user?.externalOnly ? (
                <div className="grid gap-3">
                  <p className="text-sm text-muted-foreground">Your account uses SSO. Confirm your identity with your provider before deleting it. Reauthentication is valid for 10 minutes.</p>
                  <Button type="button" variant="outline" disabled={deleteLoading} onClick={handleStartAccountReauthentication}>
                    Reauthenticate with SSO
                  </Button>
                </div>
              ) : (
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
              )}

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
