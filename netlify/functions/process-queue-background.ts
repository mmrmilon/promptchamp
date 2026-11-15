import { authorizedWorker, runQueueBatch } from '../../server/processing';
export default async function(request: Request) {
  if(!authorizedWorker(request)) return new Response('Unauthorized',{status:401});
  await runQueueBatch();
}
