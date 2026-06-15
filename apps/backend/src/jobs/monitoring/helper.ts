import { Buffer } from 'buffer';

export type MonitoringRequestAuth =
    | { type: 'bearer'; token: string }
    | { type: 'basic'; username: string; password: string }
    | { type: 'header'; name: string; value: string };

export interface MonitoringRequestOptions {
    url: string;
    allowSSL: boolean;
    method?: string;
    auth?: MonitoringRequestAuth;
}

export interface MonitoringRequestResult {
    status: number;
    body: string;
    contentType: string;
    latencyMs: number;
}

/**
 * Monitor a single endpoint.
 * @param url URL to check
 * @param allowSSL Whether to ignore invalid SSL certificates
 * @returns status code of the response
 */
export async function monitorHelper({
    url,
    allowSSL,
    method = 'GET',
    auth,
}: MonitoringRequestOptions): Promise<MonitoringRequestResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const start = Date.now();

    try {
        const headers: Record<string, string> = {};
        if (auth?.type === 'bearer' && auth.token) {
            headers.Authorization = `Bearer ${auth.token}`;
        }
        if (auth?.type === 'header' && auth.name) {
            headers[auth.name] = auth.value ?? '';
        }

        if (auth?.type === 'basic') {
            const credentials = Buffer.from(`${auth.username}:${auth.password}`).toString('base64');
            headers.Authorization = `Basic ${credentials}`;
        }

        const res = await fetch(url, {
            method,
            signal: controller.signal,
            headers,
            ...(allowSSL && url.startsWith('https://')
                ? { tls: { rejectUnauthorized: false } }
                : {}),
        });

        const body = await res.text();
        const latencyMs = Date.now() - start;

        return {
            status: res.status,
            body,
            contentType: res.headers.get("content-type") || "",
            latencyMs,
        };
    } finally {
        clearTimeout(timeout);
    }
}
