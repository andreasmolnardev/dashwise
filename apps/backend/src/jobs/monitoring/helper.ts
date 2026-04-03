import axios from 'axios';
import { AxiosRequestConfig } from 'axios';
import https from 'https';

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
        const agent = (allowSSL && url.startsWith('https://'))
            ? new https.Agent({ rejectUnauthorized: false })
            : undefined;

        const headers: Record<string, string> = {};
        if (auth?.type === 'bearer' && auth.token) {
            headers.Authorization = `Bearer ${auth.token}`;
        }
        if (auth?.type === 'header' && auth.name) {
            headers[auth.name] = auth.value ?? '';
        }

        const requestConfig: AxiosRequestConfig = {
            url,
            method,
            signal: controller.signal,
            timeout: 10_000,
            httpsAgent: agent,
            headers,
            validateStatus: () => true, // don't throw on non-200 responses
        };

        if (auth?.type === 'basic') {
            requestConfig.auth = {
                username: auth.username,
                password: auth.password,
            };
        }

        const res = await axios.request(requestConfig);

        return res.status;
    } finally {
        clearTimeout(timeout);
    }
}
