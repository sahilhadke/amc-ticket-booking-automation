import { sleep } from './human';
import { log } from './logger';

const CAPSOLVER_URL = 'https://api.capsolver.com';
const AMC_SITEKEY   = process.env.AMC_SITEKEY ?? '0x4AAAAAAA9oPHboisPr8cag';
const AMC_URL       = 'https://www.amctheatres.com';

interface TaskResponse {
  errorId: number;
  errorCode?: string;
  errorDescription?: string;
  taskId?: string;
}

interface ResultResponse {
  errorId: number;
  status: 'idle' | 'processing' | 'ready' | 'failed';
  solution?: { token: string };
  errorDescription?: string;
}

export async function solveTurnstile(apiKey: string): Promise<string> {
  log('Submitting Turnstile task to CapSolver...');

  const createRes = await fetch(`${CAPSOLVER_URL}/createTask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientKey: apiKey,
      task: {
        type: 'AntiTurnstileTaskProxyLess',
        websiteURL: AMC_URL,
        websiteKey: AMC_SITEKEY,
      },
    }),
  });

  const createData: TaskResponse = await createRes.json();
  if (createData.errorId !== 0 || !createData.taskId) {
    throw new Error(`CapSolver createTask failed: ${createData.errorDescription ?? createData.errorCode}`);
  }

  const taskId = createData.taskId;
  log(`CapSolver task created: ${taskId}`);

  // Poll for result (max 120s, every 3s)
  for (let i = 0; i < 40; i++) {
    await sleep(3000);

    const resultRes = await fetch(`${CAPSOLVER_URL}/getTaskResult`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientKey: apiKey, taskId }),
    });

    const resultData: ResultResponse = await resultRes.json();

    if (resultData.status === 'ready' && resultData.solution?.token) {
      log('Turnstile solved by CapSolver');
      return resultData.solution.token;
    }

    if (resultData.status === 'failed') {
      throw new Error(`CapSolver task failed: ${resultData.errorDescription}`);
    }

    log(`CapSolver status: ${resultData.status} (attempt ${i + 1}/40)`);
  }

  throw new Error('CapSolver timed out after 120s');
}
