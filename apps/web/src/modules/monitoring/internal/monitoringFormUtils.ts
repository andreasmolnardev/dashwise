export type EndpointAuthMode = "none" | "basic" | "bearer" | "header";

export const parseMaybeJson = (value: string): unknown =>
  value.trim() ? (() => { try { return JSON.parse(value.trim()) } catch { return value.trim() } })() : undefined;

export function parseEndpointAuth(raw: unknown): {
  mode: EndpointAuthMode;
  username?: string;
  password?: string;
  token?: string;
  headerName?: string;
  headerValue?: string;
} {
  if (!raw) return { mode: "none" };

  if (typeof raw === "string") {
    try {
      return parseEndpointAuth(JSON.parse(raw));
    } catch {
      return { mode: "none" };
    }
  }

  if (typeof raw === "object") {
    const type = (raw as any).type;
    if (type === "basic") {
      return {
        mode: "basic",
        username: String((raw as any).username || ""),
        password: String((raw as any).password || ""),
      };
    }
    if (type === "bearer") {
      return { mode: "bearer", token: String((raw as any).token || "") };
    }
    if (type === "header") {
      return {
        mode: "header",
        headerName: String((raw as any).name || ""),
        headerValue: String((raw as any).value || ""),
      };
    }
  }

  return { mode: "none" };
}

export function buildEndpointAuthPayload({
  mode,
  basicUsername,
  basicPassword,
  bearerToken,
  headerName,
  headerValue,
}: {
  mode: EndpointAuthMode;
  basicUsername?: string;
  basicPassword?: string;
  bearerToken?: string;
  headerName?: string;
  headerValue?: string;
}) {
  if (mode === "basic") {
    return { type: "basic", username: basicUsername ?? "", password: basicPassword ?? "" };
  }

  if (mode === "bearer") {
    return { type: "bearer", token: bearerToken ?? "" };
  }

  if (mode === "header") {
    return { type: "header", name: headerName ?? "", value: headerValue ?? "" };
  }

  return null;
}

export function buildResponseUpFilter({
  acceptStatusCodes,
  acceptBodyProperties,
}: {
  acceptStatusCodes?: string;
  acceptBodyProperties?: string;
}) {
  const responseUpFilter: Record<string, unknown> = {};

  if (acceptStatusCodes?.trim()) {
    responseUpFilter.acceptStatusCodes = acceptStatusCodes.trim();
  }

  if (acceptBodyProperties?.trim()) {
    responseUpFilter.acceptBodyProperties = parseMaybeJson(acceptBodyProperties);
  }

  return Object.keys(responseUpFilter).length > 0 ? responseUpFilter : undefined;
}

export function parseResponseFilter(raw: unknown) {
  if (!raw) return {} as { acceptStatusCodes?: string; acceptBodyProperties?: unknown };

  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return typeof parsed === "object" && parsed ? parsed : {};
    } catch {
      return { acceptStatusCodes: raw };
    }
  }

  if (typeof raw === "object") {
    return raw as { acceptStatusCodes?: string; acceptBodyProperties?: unknown };
  }

  return {};
}
