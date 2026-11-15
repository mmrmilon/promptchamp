export function formatLocalInput(instant:string,timeZone:string){
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(instant));
 const values=Object.fromEntries(parts.map(p=>[p.type,p.value]));return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
}
export function zonedInstant(local:string,timeZone:string){
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local))throw new Error('Choose a valid event date and time.');
 const target=Date.parse(local+':00Z');let guess=target;
 for(let count=0;count<4;count++){const displayed=Date.parse(formatLocalInput(new Date(guess).toISOString(),timeZone)+':00Z');const delta=target-displayed;if(!delta)break;guess+=delta;}
 if(formatLocalInput(new Date(guess).toISOString(),timeZone)!==local)throw new Error('That local time does not exist in this time zone. Choose another time.');
 return new Date(guess).toISOString();
}
