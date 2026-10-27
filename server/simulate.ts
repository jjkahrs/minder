// npm run simulate: replays a fake but realistic hook sequence against a running Minder server.
// Payload shapes mirror Claude Code hook input (https://code.claude.com/docs/en/hooks): common fields
// (session_id, transcript_path, cwd, permission_mode, hook_event_name) plus per-event fields;
// events fired inside a subagent also carry agent_id/agent_type.
import { randomUUID } from 'node:crypto';

const port = Number(process.env.MINDER_PORT) || 4777;
const url = `http://127.0.0.1:${port}/hook`;

const A = randomUUID();
const B = randomUUID();
const EXPLORE = 'agent-' + randomUUID().slice(0, 8);
const GENERAL = 'agent-' + randomUUID().slice(0, 8);
const cwd = { [A]: 'C:\\dev\\minder', [B]: 'C:\\dev\\atlas-api' };
const sub = (agent_id: string) => ({ agent_id, agent_type: agent_id === EXPLORE ? 'Explore' : 'general-purpose' });

type Fields = Record<string, unknown>;
// [seconds to wait before sending, session, event, extra fields]
const steps: [number, string, string, Fields?][] = [
  [0, A, 'SessionStart', { source: 'startup', model: 'claude-opus-5-5' }],
  [1, B, 'SessionStart', { source: 'startup', model: 'claude-sonnet-5-5' }],
  [1.5, A, 'UserPromptSubmit', { prompt: 'Find where hook events are reduced and add a test for SubagentStop' }],
  [1.5, A, 'PreToolUse', { tool_name: 'Read', tool_input: { file_path: 'C:\\dev\\minder\\shared\\state.ts' } }],
  [1, B, 'UserPromptSubmit', { prompt: 'Run the test suite and fix whatever fails' }],
  [1, A, 'PostToolUse', { tool_name: 'Read', tool_input: { file_path: 'C:\\dev\\minder\\shared\\state.ts' }, tool_response: { type: 'text' } }],
  [0.5, B, 'PreToolUse', { tool_name: 'Bash', tool_input: { command: 'npm test', description: 'Run tests' } }],
  [1.5, A, 'PreToolUse', { tool_name: 'Agent', tool_input: { description: 'Survey reducer call sites', subagent_type: 'Explore' } }],
  [0.5, A, 'SubagentStart', sub(EXPLORE)],
  [0.5, A, 'SubagentStart', sub(GENERAL)],
  [1, A, 'PreToolUse', { ...sub(EXPLORE), tool_name: 'Grep', tool_input: { pattern: 'reduce\\(', path: 'C:\\dev\\minder' } }],
  [1, B, 'PostToolUseFailure', { tool_name: 'Bash', tool_input: { command: 'npm test' }, error: 'Command failed with exit code 1\n2 tests failed', is_interrupt: false }],
  [0.5, A, 'PreToolUse', { ...sub(GENERAL), tool_name: 'Glob', tool_input: { pattern: 'shared/**/*.test.ts' } }],
  [1.5, A, 'PostToolUse', { ...sub(EXPLORE), tool_name: 'Grep', tool_response: { numFiles: 3 } }],
  [0.5, B, 'PreToolUse', { tool_name: 'Edit', tool_input: { file_path: 'C:\\dev\\atlas-api\\src\\routes.ts' } }],
  [1, A, 'PostToolUse', { ...sub(GENERAL), tool_name: 'Glob', tool_response: { numFiles: 2 } }],
  [0.5, A, 'PreToolUse', { ...sub(EXPLORE), tool_name: 'Read', tool_input: { file_path: 'C:\\dev\\minder\\server\\app.ts' } }],
  [1, B, 'PostToolUse', { tool_name: 'Edit', tool_response: { success: true } }],
  [1, B, 'PreToolUse', { tool_name: 'Bash', tool_input: { command: 'rm -rf node_modules/.cache && npm test' } }],
  [0.5, B, 'Notification', { notification_type: 'permission_prompt', title: 'Permission needed', message: 'Claude needs your permission to use Bash' }],
  [1, A, 'PreToolUse', { ...sub(GENERAL), tool_name: 'Bash', tool_input: { command: 'npx vitest run shared/missing.test.ts' } }],
  [1.5, A, 'PostToolUseFailure', { ...sub(GENERAL), tool_name: 'Bash', error: 'No test files found', is_interrupt: false }],
  [1.5, A, 'PostToolUse', { ...sub(EXPLORE), tool_name: 'Read', tool_response: { type: 'text' } }],
  [1, A, 'SubagentStop', { ...sub(EXPLORE), stop_hook_active: false }],
  [3, B, 'PostToolUse', { tool_name: 'Bash', tool_response: { stdout: '42 passed', exit_code: 0 } }],
  [1, A, 'PreToolUse', { ...sub(GENERAL), tool_name: 'Write', tool_input: { file_path: 'C:\\dev\\minder\\shared\\subagent.test.ts' } }],
  [2, A, 'PostToolUse', { ...sub(GENERAL), tool_name: 'Write', tool_response: { success: true } }],
  [1, A, 'SubagentStop', { ...sub(GENERAL), stop_hook_active: false }],
  [1, A, 'PostToolUse', { tool_name: 'Agent', tool_response: { status: 'completed' } }],
  [1, B, 'Stop', { stop_hook_active: false }],
  [1.5, A, 'Stop', { stop_hook_active: false }],
  [1, A, 'Notification', { notification_type: 'idle_prompt', message: 'Claude is waiting for your input' }],
  [5, B, 'SessionEnd', { reason: 'prompt_input_exit' }],
  [4, A, 'UserPromptSubmit', { prompt: 'Looks good, thanks' }],
  [2, A, 'Stop', { stop_hook_active: false }],
  [2, A, 'SessionEnd', { reason: 'prompt_input_exit' }],
];

const sleep = (s: number) => new Promise((r) => setTimeout(r, s * 1000));
const t0 = Date.now();

for (const [wait, session_id, hook_event_name, fields] of steps) {
  await sleep(wait);
  const body = {
    session_id,
    transcript_path: `C:\\Users\\you\\.claude\\projects\\sim\\${session_id}.jsonl`,
    cwd: cwd[session_id],
    permission_mode: 'default',
    hook_event_name,
    ...fields,
  };
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    console.error(`[simulate] cannot reach Minder at ${url} (${((err as Error).cause as { code?: string })?.code ?? (err as Error).message}). Start it with \`npm start\`.`);
    process.exit(1);
  }
  const who = (fields?.agent_type as string) ?? (session_id === A ? 'session A' : 'session B');
  const what = (fields?.tool_name ?? fields?.notification_type ?? '') as string;
  console.log(`[simulate] +${((Date.now() - t0) / 1000).toFixed(1).padStart(4)}s  ${who.padEnd(15)} ${hook_event_name} ${what}`);
}
console.log('[simulate] done');
