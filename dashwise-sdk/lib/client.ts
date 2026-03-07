import PocketBase from "pocketbase";

const truthyEnv = (value?: string | null): boolean => {
  if (!value) return false;
  return value === "1" || value.toLowerCase() === "true";
};

export interface DashwiseSDKConnectorOptions {
  pbUrl?: string;
  superuserEmail?: string;
  superuserPassword?: string;
  enableSSO?: boolean;
}

export class DashwiseSDKConnector {
  private readonly pbUrl: string;
  private readonly superuserEmail: string | undefined;
  private readonly superuserPassword: string | undefined;
  private readonly enableSSOFlag: boolean;
  private superuserClientPromise: Promise<PocketBase> | null = null;

  constructor(options: DashwiseSDKConnectorOptions = {}) {
    this.pbUrl =
      options.pbUrl ??
      process.env.NEXT_PUBLIC_PB_URL ??
      process.env.PB_URL ?? ""
    this.superuserEmail = options.superuserEmail ?? process.env.PB_ADMIN_EMAIL;
    this.superuserPassword = options.superuserPassword ?? process.env.PB_ADMIN_PASSWORD;
    this.enableSSOFlag =
      options.enableSSO ?? truthyEnv(process.env.NEXT_PUBLIC_ENABLE_SSO) ?? false;
  }

  getAppConfig() {
    return {
      enableSSO: this.enableSSOFlag,
    };
  }

  createServerClient(cookieHeader?: string) {
    const pb = new PocketBase(this.pbUrl);
    pb.autoCancellation(false);
    if (cookieHeader) {
      pb.authStore.loadFromCookie(cookieHeader);
    }
    return pb;
  }

  async getSuperuserClient() {
    if (!this.superuserEmail || !this.superuserPassword) {
      throw new Error("Dashwise SDK superuser credentials are not configured");
    }

    if (this.superuserClientPromise) {
      try {
        const existing = await this.superuserClientPromise;
        if (existing.authStore.isValid) {
          return existing;
        }
      } catch {
        this.superuserClientPromise = null;
      }
    }

    this.superuserClientPromise = this.authenticateSuperuser();
    return this.superuserClientPromise;
  }

  private async authenticateSuperuser() {
    const pb = new PocketBase(this.pbUrl);
    pb.autoCancellation(false);
    await pb.collection("_superusers").authWithPassword(
      this.superuserEmail!,
      this.superuserPassword!
    );
    return pb;
  }
}
