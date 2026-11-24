import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from 'esbuild';
import sharp from 'sharp';
import jsQR from 'jsqr';
await build({entryPoints:['registration-qr.ts'],outfile:'.netlify/local/registration-qr-test.mjs',bundle:true,platform:'node',format:'esm',packages:'external'});
const {registrationQR,registrationLink}=await import('../.netlify/local/registration-qr-test.mjs');

test('rendered QR images decode to the exact registration URL for each event',async()=>{
 for(const slug of ['it-connect-december-d6b8ffc7','another-office-event','a'.repeat(100)]){
  const expected='https://promptchamp.mmizanurrahman.com/event?event='+slug;
  const qr=await registrationQR(slug,'https://promptchamp.mmizanurrahman.com/admin?ignored=true');
  assert.equal(qr.link,expected);
  assert.equal(decodeURIComponent(qr.image.split(',').slice(1).join(',')),qr.svg);
  const {data,info}=await sharp(Buffer.from(qr.svg)).resize(720,720,{kernel:'nearest'}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const decoded=jsQR(new Uint8ClampedArray(data),info.width,info.height);
  assert.equal(decoded?.data,expected);
  // Keep a white quiet zone at the edge for reliable camera scanning.
  assert.deepEqual([...data.subarray(0,4)],[255,255,255,255]);
 }
});

test('QR targets exclude page paths, invitation tokens and fragments',()=>{
 assert.equal(registrationLink('test-event','http://localhost:5173/admin?invite=private#fragment'),'http://localhost:5173/event?event=test-event');
 for(const slug of ['', '../admin','test&invite=private','<script>'])assert.throws(()=>registrationLink(slug,'https://example.test'));
 assert.throws(()=>registrationLink('test-event','javascript:alert(1)'));
});
