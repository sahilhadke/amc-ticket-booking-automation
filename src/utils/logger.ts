const ts = () => new Date().toISOString();

export const log   = (msg: string) => console.log(`[${ts()}] INFO  ${msg}`);
export const warn  = (msg: string) => console.warn(`[${ts()}] WARN  ${msg}`);
export const error = (msg: string) => console.error(`[${ts()}] ERROR ${msg}`);
