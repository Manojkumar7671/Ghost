import { isIP } from 'net';
import dns from 'dns/promises';

const BLOCKED_HOSTNAMES = ['localhost', '0.0.0.0', 'metadata.google.internal'];

function isPrivateIp(ip) {
    const parts = ip.split('.').map(Number);
    if (ip.startsWith('127.')) return true;
    if (ip.startsWith('10.')) return true;
    if (ip.startsWith('192.168.')) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (ip.startsWith('169.254.')) return true; // link-local, includes cloud metadata endpoint
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
    // Resolve DNS and check the resolved IP too, to block DNS-rebinding to internal IPs
    const addresses = await dns.resolve4(hostname).catch(() => []);
    for (const addr of addresses) {
        if (isPrivateIp(addr)) throw new Error('Hostname resolves to a private/internal IP — blocked');
    }
}
