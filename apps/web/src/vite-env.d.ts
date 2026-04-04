/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly NEXT_PUBLIC_APP_URL?: string;
  readonly NEXT_PUBLIC_BACKEND_URL?: string;
  readonly NEXT_PUBLIC_PB_URL?: string;
  readonly NEXT_PUBLIC_JOBS_URL?: string;
  readonly NEXT_PUBLIC_DEFAULT_BG_URL?: string;
  readonly NEXT_PUBLIC_INTEGRATIONS_ENABLE_SSL?: string;
  readonly NEXT_PUBLIC_ENABLE_SSO?: string;
  readonly NEXT_PUBLIC_DISABLE_USER_SIGNUP?: string;
  readonly NEXT_PUBLIC_JOBS_WEBHOOK_ENABLE?: string;
  readonly PB_ADMIN_EMAIL?: string;
  readonly PB_ADMIN_PASSWORD?: string;
}