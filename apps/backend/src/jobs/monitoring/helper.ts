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
}: MonitoringRequestOptions): Promise<number> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

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

        return res.status;
    } finally {
        clearTimeout(timeout);
    }
}
