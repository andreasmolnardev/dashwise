import axios from 'axios';
import https from 'https';

/**
 * Monitor a single endpoint.
 * @param url URL to check
 * @param allowSSL Whether to ignore invalid SSL certificates
 * @returns status code of the response
 */
export async function monitorHelper(url: string, allowSSL: boolean): Promise<number> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
        const agent = (allowSSL && url.startsWith('https://'))
            ? new https.Agent({ rejectUnauthorized: false })
            : undefined;

        const res = await axios.get(url, {
            signal: controller.signal,
            timeout: 10_000,
            httpsAgent: agent,
            validateStatus: () => true, // don't throw on non-200 responses
        });

        return res.status;
    } finally {
        clearTimeout(timeout);
    }
}
