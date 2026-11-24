import QRCode from 'qrcode';

export function registrationLink(slug:string,origin:string){
 if(!/^[a-z0-9-]{3,100}$/.test(slug))throw new Error('Invalid event address.');
 const base=new URL(origin);
 if(!['https:','http:'].includes(base.protocol))throw new Error('Invalid application address.');
 const url=new URL('/event',base.origin);url.searchParams.set('event',slug);return url.href;
}

export async function registrationQR(slug:string,origin:string){
 const link=registrationLink(slug,origin);
 const svg=await QRCode.toString(link,{type:'svg',errorCorrectionLevel:'M',margin:4,color:{dark:'#142019',light:'#ffffff'}});
 return {link,svg,image:'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg)};
}
