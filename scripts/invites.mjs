import { randomBytes, createHash } from 'node:crypto';
const count = Number(process.argv[2] ?? 20);
if (!Number.isInteger(count) || count < 1 || count > 100) throw new Error('Specify 1–100 invites.');
for (let i = 0; i < count; i++) {
  const code = randomBytes(12).toString('hex');
  const hash = createHash('sha256').update(code).digest('hex');
  console.log(`-- Invite ${i + 1}: ${code}\ninsert into players (invite_hash) values ('${hash}');`);
}
