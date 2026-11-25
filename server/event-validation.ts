import {normalizeEventAddress} from '../event-address';
// Return field names used by the host form so validation failures are actionable.
export function eventSettingsErrors(body:any, creating=false) {
  const fields:Record<string,string>={};
  const title=typeof body.title==='string'?body.title.trim():'';
  if(title.length<3||title.length>100)fields.title='Enter an event title with 3–100 characters, excluding surrounding spaces.';
  if(creating){
    const slug=normalizeEventAddress(body.slug);
    if(!/^[a-z0-9-]{3,100}$/.test(slug))fields.slug='Use 3–100 letters, numbers or hyphens for the event address, for example it-connect-december.';
  }
  if(typeof body.scheduledAt!=='string'||!Number.isFinite(Date.parse(body.scheduledAt)))fields.scheduledAt='Choose a valid event date and time.';
  if(![120,180].includes(body.durationSeconds))fields.durationSeconds='Choose a team timer of 2 or 3 minutes.';
  if(!Number.isInteger(body.generationCap)||body.generationCap<1||body.generationCap>10000)fields.generationCap='Set the maximum image requests between 1 and 10,000 under Advanced: AI safety limit.';
  const capacity=body.teamCapacity??20;
  if(!Number.isInteger(capacity)||capacity<1||capacity>100)fields.teamCapacity='Set the expected number of teams between 1 and 100.';
  return fields;
}
