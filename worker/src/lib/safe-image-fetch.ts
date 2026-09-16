import { Errors } from './errors';

export const MAX_MENU_IMAGE_BYTES = 5 * 1024 * 1024;
export const MENU_IMAGE_TIMEOUT_MS = 10_000;
export const MAX_MENU_IMAGE_REDIRECTS = 3;
const ALLOWED_CONTENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function isBlockedIpv4(host: string): boolean {
  const parts = host.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isBlockedIpv6(host: string): boolean {
  const normalized = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (normalized.startsWith('::ffff:')) {
    return isBlockedIpv4(normalized.slice('::ffff:'.length));
  }
  return (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb')
  );
}

export function assertSafeImageUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw Errors.validation('圖片網址格式無效');
  }
  if (url.protocol !== 'https:') throw Errors.validation('圖片網址只接受 HTTPS');
  if (url.username || url.password) throw Errors.validation('圖片網址不可包含登入資訊');
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host === 'metadata.google.internal' ||
    host === 'metadata' ||
    host === 'instance-data' ||
    isBlockedIpv4(host) ||
    isBlockedIpv6(host)
  ) {
    throw Errors.validation('圖片網址不可指向本機或內部網路');
  }
  return url;
}

export function safeSourceUrl(url: URL): string {
  return `${url.protocol}//${url.host}${url.pathname}`;
}

async function defaultResolve(hostname: string): Promise<string[]> {
  if (isBlockedIpv4(hostname) || isBlockedIpv6(hostname)) return [hostname];
  const responses = await Promise.all(
    ['A', 'AAAA'].map((type) =>
      fetch(
        `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=${type}`,
        { headers: { Accept: 'application/dns-json' } },
      ),
    ),
  );
  if (responses.some((response) => !response.ok)) throw Errors.validation('無法驗證圖片主機');
  const payloads = (await Promise.all(responses.map((response) => response.json()))) as Array<{
    Answer?: Array<{ data?: string }>;
  }>;
  return payloads.flatMap((json) =>
    (json.Answer ?? []).map((answer) => answer.data || '').filter(Boolean),
  );
}

async function assertPublicResolution(
  hostname: string,
  resolveHost: (hostname: string) => Promise<string[]>,
): Promise<void> {
  const addresses = await resolveHost(hostname);
  if (addresses.length === 0) throw Errors.validation('圖片主機無法解析');
  if (addresses.some((address) => isBlockedIpv4(address) || isBlockedIpv6(address))) {
    throw Errors.validation('圖片網址解析到內部網路，已拒絕下載');
  }
}

export interface SafeImageResult {
  bytes: Uint8Array;
  contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  finalUrl: URL;
  safeUrl: string;
  sha256: string;
}

function matchesImageSignature(bytes: Uint8Array, contentType: SafeImageResult['contentType']): boolean {
  if (contentType === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (contentType === 'image/png') {
    return (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    );
  }
  return (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  );
}

async function readLimitedBody(response: Response): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_MENU_IMAGE_BYTES) {
      await reader.cancel();
      throw Errors.validation('圖片大小不可超過 5MB');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function fetchSafeMenuImage(
  value: string,
  options: {
    fetchImpl?: typeof fetch;
    resolveHost?: (hostname: string) => Promise<string[]>;
    timeoutMs?: number;
    maxRedirects?: number;
  } = {},
): Promise<SafeImageResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const resolveHost = options.resolveHost ?? defaultResolve;
  const timeoutMs = options.timeoutMs ?? MENU_IMAGE_TIMEOUT_MS;
  const maxRedirects = options.maxRedirects ?? MAX_MENU_IMAGE_REDIRECTS;
  let url = assertSafeImageUrl(value);
  let response: Response | null = null;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(Errors.imageDownloadTimeout());
    }, timeoutMs);
  });
  try {
    for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
      await Promise.race([assertPublicResolution(url.hostname, resolveHost), timeout]);
      try {
        response = await Promise.race([
          fetchImpl(url.toString(), {
            method: 'GET',
            redirect: 'manual',
            signal: controller.signal,
            headers: { Accept: 'image/jpeg,image/png,image/webp' },
          }),
          timeout,
        ]);
      } catch (err) {
        if (err instanceof Error && 'status' in err) throw err;
        if (err instanceof DOMException && err.name === 'AbortError') {
          throw Errors.imageDownloadTimeout();
        }
        throw Errors.validation('圖片下載失敗，可能有防盜連或網址已過期');
      }
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) throw Errors.validation('圖片重新導向缺少目標網址');
        if (redirects >= maxRedirects) throw Errors.validation('圖片重新導向次數過多');
        url = assertSafeImageUrl(new URL(location, url).toString());
        continue;
      }
      break;
    }
    if (!response?.ok) {
      throw Errors.validation('圖片下載失敗，可能有防盜連或網址已過期');
    }
    const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() || '';
    if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
      throw Errors.validation('圖片格式僅支援 JPEG、PNG、WebP');
    }
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > MAX_MENU_IMAGE_BYTES) throw Errors.validation('圖片大小不可超過 5MB');
    const bytes = await Promise.race([readLimitedBody(response), timeout]);
    if (!matchesImageSignature(bytes, contentType as SafeImageResult['contentType'])) {
      throw Errors.validation('圖片內容與宣告格式不符');
    }
    const digestInput = new Uint8Array(bytes.byteLength);
    digestInput.set(bytes);
    const hash = await crypto.subtle.digest('SHA-256', digestInput);
    const sha256 = [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    return {
      bytes,
      contentType: contentType as SafeImageResult['contentType'],
      finalUrl: url,
      safeUrl: safeSourceUrl(url),
      sha256,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
