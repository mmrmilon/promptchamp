import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const hash = (text: string) => createHash('sha256').update(text).digest();
export function validHostKey(key: unknown) {
  return typeof key === 'string' && !!process.env.ADMIN_ACCESS_KEY &&
    process.env.ADMIN_ACCESS_KEY.length >= 32 && timingSafeEqual(hash(key), hash(process.env.ADMIN_ACCESS_KEY));
}
function signature(text: string) {
  return createHmac('sha256', process.env.SESSION_SECRET!).update('host:' + text).digest('hex');
}
export function hostCookie(request: Request, clear = false) {
  const value = randomBytes(16).toString('hex') + '.' + (Date.now() + 8 * 3600_000);
  return `pc_host=${clear ? '' : value + '.' + signature(value)}; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : 28800}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
}
export function isHost(request: Request) {
  const value = request.headers.get('cookie')?.match(/(?:^|;\s*)pc_host=([^;]+)/)?.[1];
  const pieces = value?.split('.') ?? [];
  if (pieces.length !== 3 || !/^[a-f0-9]{32}$/.test(pieces[0]) || !/^\d+$/.test(pieces[1]) ||
      Number(pieces[1]) <= Date.now() || !/^[a-f0-9]{64}$/.test(pieces[2])) return false;
  return timingSafeEqual(Buffer.from(pieces[2], 'hex'), Buffer.from(signature(pieces.slice(0, 2).join('.')), 'hex'));
}
