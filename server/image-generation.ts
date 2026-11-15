import type { Picture } from './image-judging';

export async function generate(prompt: string): Promise<Picture> {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!account || !token) throw new Error('Missing Cloudflare Workers AI credentials');
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/ai/run/@cf/black-forest-labs/flux-1-schnell`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, steps: 4 }),
      signal: AbortSignal.timeout(27_000),
    });
  if (!response.ok) throw new Error(`Cloudflare FLUX status ${response.status}`);
  const payload = await response.json();
  const data = payload.result?.image;
  if (payload.success !== true || typeof data !== 'string' || !data.length ||
      data.length > 4_500_000 || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data) ||
      !Buffer.from(data, 'base64').subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) {
    throw new Error('Cloudflare returned no supported JPEG within response size limit');
  }
  return { mimeType: 'image/jpeg', data };
}
