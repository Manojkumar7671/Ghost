import { isIP } from 'net';
import dns from 'dns/promises';
import { Agent } from 'undici';

const BLOCKED_HOSTNAMES = ['localhost', '0.0.0.0', 'metadata.google.internal'];

export function isPrivateIp(ip) {
    const parts = ip.split('.').map(Number);
    if (ip.startsWith('127.')) return true;
    if (ip.startsWith('10.')) return true;
    if (ip.startsWith('192.168.')) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (ip.startsWith('169.254.')) return true;
    if (ip === '::1') return true;
    return false;
}

export async function assertSafeUrl(urlString) {
    let parsed;
    try {
        parsed = new URL(urlString);
    } catch {
        throw new Error('Invalid URL');
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('Only http/https URLs are allowed');
    }
    const hostname = parsed.hostname.toLowerCase();
    if (BLOCKED_HOSTNAMES.includes(hostname)) {
        throw new Error('Requests to this hostname are blocked');
    }
    if (isIP(hostname)) {
        if (isPrivateIp(hostname)) throw new Error('Requests to private/internal IP ranges are blocked');
        return;
    }
    const addresses = await dns.resolve4(hostname).catch(() => []);
    for (const addr of addresses) {
        if (isPrivateIp(addr)) throw new Error('Hostname resolves to a private/internal IP — blocked');
    }
}

export async function safeFetch(urlString, options = {}) {
    let currentUrl = urlString;
    let redirectCount = 0;
    const maxRedirects = 5;

    while (true) {
        let parsed;
        try {
            parsed = new URL(currentUrl);
        } catch {
            throw new Error('Invalid URL');
        }

        // Validate that the URL is safe
        await assertSafeUrl(currentUrl);

        const hostname = parsed.hostname;
        let resolvedIp = hostname;

        if (!isIP(hostname)) {
            const addresses = await dns.resolve4(hostname);
            if (!addresses || addresses.length === 0) {
                throw new Error(`DNS resolution failed for ${hostname}`);
            }
            resolvedIp = addresses[0];
            if (isPrivateIp(resolvedIp)) {
                throw new Error(`Forbidden IP resolved: ${resolvedIp}`);
            }
        }

        const protocol = parsed.protocol;
        const port = parsed.port ? `:${parsed.port}` : '';
        const ipUrl = `${protocol}//${resolvedIp}${parsed.pathname}${parsed.search}`;

        const headers = {
            ...options.headers,
            'Host': hostname
        };

        let dispatcher;
        if (protocol === 'https:') {
            dispatcher = new Agent({
                connect: {
                    servername: hostname,
                    rejectUnauthorized: true
                }
            });
        }

        const fetchOptions = {
            ...options,
            headers,
            redirect: 'manual',
            dispatcher
        };

        const res = await fetch(ipUrl, fetchOptions);

        if ([301, 302, 303, 307, 308].includes(res.status)) {
            redirectCount++;
            if (redirectCount > maxRedirects) {
                throw new Error('Too many redirects');
            }

            const location = res.headers.get('location');
            if (!location) {
                throw new Error('Redirect response missing location header');
            }

            // Resolve relative Location header against currentUrl
            currentUrl = new URL(location, currentUrl).toString();
            continue;
        }

        return res;
    }
}
