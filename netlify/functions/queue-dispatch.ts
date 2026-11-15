import { wakeWorker } from '../../server/processing';
export const config = {schedule:'* * * * *'};
export default async function() { await wakeWorker(); }
