const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const HOME = os.homedir();
const PORT = Number(process.env.AGENT_OBSERVATORY_PORT || process.env.CODEX_HUB_PORT || 4180);
const TRASH = path.join(HOME, '.Trash');
const AGENTS = {
  codex: { label: 'Codex', mark: 'C', root: path.join(HOME, '.codex'), canResume: true },
  claude: { label: 'Claude Code', mark: 'A', root: path.join(HOME, '.claude'), canResume: true },
  openclaw: { label: 'OpenClaw', mark: 'O', root: path.join(HOME, '.openclaw'), canResume: false },
  pi: { label: 'Pi Agent', mark: 'P', root: process.env.PI_CODING_AGENT_DIR || path.join(HOME, '.pi', 'agent'), canResume: false },
};
const CODEX = AGENTS.codex.root;
const TRASH_INDEX = path.join(CODEX, '.codex-hub-trash-index.json');

function files(dir, predicate = (x) => x.endsWith('.jsonl')) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  const walk = (current) => {
    for (const name of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, name.name);
      if (name.isDirectory()) walk(full);
      else if (predicate(full)) out.push(full);
    }
  };
  walk(dir); return out;
}
const jsonlFiles = (dir) => files(dir, (x) => x.endsWith('.jsonl'));
const safeParse = (line) => { try { return JSON.parse(line); } catch { return null; } };
const readLines = (file) => { try { return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean); } catch { return []; } };
function cleanText(text) { return String(text || '').replace(/<environment_context>[\s\S]*?<\/environment_context>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); }
function isNoise(text) {
  return !text || /^(## Memory|You are `\/root`|Filesystem sandboxing|Collaboration Mode|<skills_instructions>)/.test(text)
    || /^#?\s*AGENTS\.md instructions\b/i.test(text) || /^(Available skills|You are Codex, an agent based on GPT)/i.test(text)
    || /^\[(local-command-caveat|Request interrupted)/i.test(text);
}
function contentText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((part) => {
    if (typeof part === 'string') return part;
    if (!part) return '';
    if (part.text || part.output_text) return part.text || part.output_text;
    if (part.thinking) return part.thinking;
    if (part.type === 'toolCall' || part.type === 'tool_use') return `[工具调用] ${part.name || 'tool'}`;
    if (part.type === 'tool_result') return `[工具结果] ${part.content || ''}`;
    return '';
  }).join('\n');
}
function piSessionsRoot() {
  if (process.env.PI_CODING_AGENT_SESSION_DIR) return process.env.PI_CODING_AGENT_SESSION_DIR;
  return path.join(AGENTS.pi.root, 'sessions');
}
function runtimeInfo(agent, events, archived = false, trashed = false) {
  const latest = events.reduce((max, event) => Math.max(max, event.time || 0), 0);
  const latestEvent = [...events].reverse().find((event) => event.kind !== 'usage') || events.at(-1) || {};
  const age = latest ? Math.max(0, Math.floor((Date.now() - latest) / 1000)) : null;
  const recent = age !== null && age < 8 * 60;
  const hasError = events.slice(-30).some((event) => event.kind === 'error');
  const state = { lastEventAt: latest ? new Date(latest).toISOString() : '', lastRole: latestEvent.role || '', idleSeconds: age, isLive: false };
  if (trashed) return { ...state, key: 'trash', label: '废纸篓', tone: 'danger', note: '已移到系统废纸篓，恢复后才能继续。' };
  if (archived) return { ...state, key: 'archived', label: '已归档', tone: 'archive', note: '已归档保存，不参与实时监听。' };
  if (hasError && recent) return { ...state, key: 'attention', label: '需要关注', tone: 'danger', isLive: true, note: '最近事件出现错误或中断，建议打开详情确认。' };
  if (recent && ['user', 'thinking', 'tool_call', 'tool_result'].includes(latestEvent.kind)) {
    const label = latestEvent.kind === 'user' ? '正在响应用户的问题' : latestEvent.kind === 'thinking' ? '正在思考' : latestEvent.kind === 'tool_call' ? '正在执行工具' : '正在整理工具结果';
    return { ...state, key: 'responding', label, tone: 'live', isLive: true, note: `${AGENTS[agent].label} 正在处理最新请求。` };
  }
  if (recent && latestEvent.kind === 'assistant') return { ...state, key: 'just_completed', label: '刚刚完成回复', tone: 'success', note: '最近一次输出已写入会话。' };
  if (latestEvent.kind === 'user') return { ...state, key: 'waiting', label: '等待继续处理', tone: 'warm', note: '最后记录来自用户，当前没有新的 Agent 输出。' };
  if (latestEvent.kind === 'assistant') return { ...state, key: 'completed', label: '已完成回复', tone: 'quiet', note: '最后一次可见输出来自 Agent。' };
  if (latestEvent.kind === 'tool_call' || latestEvent.kind === 'tool_result') return { ...state, key: 'paused', label: '停在工具阶段', tone: 'warm', note: '最后记录与工具调用有关，可能是中断或等待恢复。' };
  return { ...state, key: 'idle', label: '暂无实时活动', tone: 'quiet', note: '没有识别到明确的实时事件。' };
}
function makeTitle(text, project, label) {
  let title = cleanText(text)
    .replace(/^\[(?:cron|message_id):[^\]]+\]\s*/i, '')
    .replace(/^(请|帮我|麻烦你|能不能|可以|我想要|我需要)\s*/, '')
    .split(/[。！？!?\n]/)[0].trim();
  if (title.length > 52) title = `${title.slice(0, 52)}…`;
  return title || `${project || '本机工作区'} · ${label} 会话`;
}
function projectInfo(cwd) {
  const normalized = path.resolve(cwd || HOME);
  const goPrefix = path.join(HOME, 'go', 'src') + path.sep;
  if (normalized.startsWith(goPrefix)) {
    const rest = normalized.slice(goPrefix.length).split(path.sep).filter(Boolean);
    const name = rest[0] || 'Go 工作区';
    return { name, root: path.join(HOME, 'go', 'src', name), module: rest.slice(1).join(' / ') };
  }
  const hasMarker = (dir) => ['.git', 'go.mod', 'package.json', 'Cargo.toml', 'pom.xml', 'build.gradle', 'AGENTS.md'].some((x) => fs.existsSync(path.join(dir, x)));
  let current = normalized; let root = '';
  while (current && current !== path.dirname(current)) { if (hasMarker(current)) { root = current; break; } current = path.dirname(current); }
  if (!root) root = normalized;
  const name = path.basename(root) || '本机工作区'; const relative = path.relative(root, normalized);
  return { name: name === path.basename(HOME) ? '本机工作区' : name, root, module: relative && !relative.startsWith('..') ? relative.split(path.sep).join(' / ') : '' };
}
const namespace = (agent, rawId) => `${agent}:${rawId}`;
function splitId(id) {
  const value = String(id || ''); const index = value.indexOf(':'); const agent = value.slice(0, index);
  return index > 0 && AGENTS[agent] ? { agent, rawId: value.slice(index + 1) } : { agent: 'codex', rawId: value };
}
function baseSession(agent, file, rawId, cwd, firstUser, messages, latest, archived = false, extra = {}) {
  let stat; try { stat = fs.statSync(file); } catch { return null; }
  const info = projectInfo(cwd || HOME); const timestamp = new Date(latest || stat.mtimeMs).toISOString();
  const runtime = extra.runtime || runtimeInfo(agent, extra.events || [], archived, extra.trashed);
  return {
    agent, agentLabel: AGENTS[agent].label, agentMark: AGENTS[agent].mark, id: namespace(agent, rawId), rawId,
    title: extra.title || makeTitle(firstUser, info.name, AGENTS[agent].label), titleSource: extra.titleSource || 'generated',
    project: info.name, projectRoot: info.root, module: info.module, path: cwd || HOME, originalPath: cwd || HOME,
    status: archived ? 'archived' : (runtime.key === 'trash' ? 'trash' : 'completed'), runtime,
    updated: timestamp, time: new Date(timestamp).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
    messages, tokens: '—', model: extra.model || '本地配置', summary: cleanText(firstUser).slice(0, 180) || '暂无用户消息摘要',
    archived, file, size: stat.size, trashBlockReason: extra.trashBlockReason || '',
    capabilities: { canResume: Boolean(AGENTS[agent].canResume), canTrash: true, canRestore: true, ...extra.capabilities },
  };
}
function codexIndex() {
  const map = new Map(); const file = path.join(CODEX, 'session_index.jsonl');
  for (const line of readLines(file)) { const x = safeParse(line); if (x?.id && x.thread_name) map.set(x.id, x.thread_name); }
  return map;
}
function readCodex(file, archived = false) {
  let meta = null; let latest = 0; let firstUser = ''; let messages = 0; const seen = new Set(); const events = [];
  for (const line of readLines(file)) {
    const x = safeParse(line); if (!x) continue; const p = x.payload || {};
    if (x.type === 'session_meta') meta = p;
    let raw = ''; if (x.type === 'response_item' && p.role === 'user') raw = contentText(p.content); if (x.type === 'event_msg' && p.item?.type === 'UserMessage') raw = contentText(p.item.content);
    const text = cleanText(raw); const key = text.toLowerCase(); if (text && !isNoise(text) && !seen.has(key)) { seen.add(key); messages += 1; if (!firstUser) firstUser = text; }
    const t = Date.parse(x.timestamp || p.timestamp || ''); if (t > latest) latest = t;
    if (t) {
      if (x.type === 'event_msg' && ['user_message', 'UserMessage'].includes(p.type || p.item?.type)) events.push({ time: t, kind: 'user', role: 'user' });
      else if (x.type === 'response_item' && p.role === 'user') events.push({ time: t, kind: 'user', role: 'user' });
      else if (x.type === 'response_item' && p.type === 'reasoning') events.push({ time: t, kind: 'thinking', role: 'assistant' });
      else if (x.type === 'response_item' && ['function_call', 'custom_tool_call'].includes(p.type)) events.push({ time: t, kind: 'tool_call', role: 'assistant' });
      else if (x.type === 'response_item' && ['function_call_output', 'custom_tool_call_output'].includes(p.type)) events.push({ time: t, kind: 'tool_result', role: 'tool' });
      else if ((x.type === 'event_msg' && p.type === 'agent_message') || (x.type === 'response_item' && p.role === 'assistant')) events.push({ time: t, kind: 'assistant', role: 'assistant' });
      else if (x.type === 'event_msg' && /error|failed|interrupted/i.test(String(p.type || p.message || ''))) events.push({ time: t, kind: 'error', role: 'system' });
      else if (x.type === 'event_msg' && p.type === 'task_complete') events.push({ time: t, kind: 'assistant', role: 'assistant' });
      else if (x.type === 'token_usage_record' || (x.type === 'event_msg' && p.type === 'token_count')) events.push({ time: t, kind: 'usage' });
    }
  }
  const rawId = meta?.id || path.basename(file).match(/01[a-z0-9-]{20,}/)?.[0] || path.basename(file); const official = codexIndex().get(rawId);
  return baseSession('codex', file, rawId, meta?.cwd || HOME, firstUser, messages, latest || fs.statSync(file).mtimeMs, archived, { title: official, titleSource: official ? 'codex-index' : undefined, model: meta?.model_provider, events });
}
function readClaude(file) {
  let latest = 0; let firstUser = ''; let messages = 0; let cwd = ''; let model = ''; const seen = new Set(); const events = [];
  for (const line of readLines(file)) {
    const x = safeParse(line); if (!x) continue; cwd ||= x.cwd || x.project || ''; const t = Date.parse(x.timestamp || ''); if (t > latest) latest = t;
    const message = x.message; const role = message?.role || (x.type === 'user' ? 'user' : x.type === 'assistant' ? 'assistant' : ''); const text = cleanText(contentText(message?.content || (x.type === 'user' ? x.message?.content : '')));
    if (message?.model) model = message.model;
    if (role === 'user' && text && !isNoise(text) && !seen.has(text.toLowerCase())) { seen.add(text.toLowerCase()); messages += 1; if (!firstUser) firstUser = text; }
    if (t) {
      if (role === 'user') events.push({ time: t, kind: 'user', role: 'user' });
      else if (role === 'assistant') events.push({ time: t, kind: 'assistant', role: 'assistant' });
      else if (/error|failed|interrupted/i.test(String(x.type || x.error || ''))) events.push({ time: t, kind: 'error', role: 'system' });
    }
  }
  const rawId = path.basename(file, '.jsonl'); if (!cwd) cwd = path.basename(path.dirname(file)).replace(/^-/, '/').replace(/-/g, '/');
  return baseSession('claude', file, rawId, cwd || HOME, firstUser, messages, latest || fs.statSync(file).mtimeMs, false, { model, events });
}
function openclawRoutedSessions() {
  const routed = new Map(); const agents = path.join(AGENTS.openclaw.root, 'agents');
  if (!fs.existsSync(agents)) return routed;
  for (const agent of fs.readdirSync(agents, { withFileTypes: true })) {
    if (!agent.isDirectory()) continue;
    const store = path.join(agents, agent.name, 'sessions', 'sessions.json');
    if (!fs.existsSync(store)) continue;
    let entries; try { entries = JSON.parse(fs.readFileSync(store, 'utf8')); }
    catch (error) { throw Error(`无法读取 OpenClaw 会话路由，已停止移动文件：${error.message}`); }
    for (const [key, entry] of Object.entries(entries)) {
      if (entry?.sessionId) routed.set(`${agent.name}:${entry.sessionId}`, key);
    }
  }
  return routed;
}
function openclawRouteKey(file, id, routed) {
  return routed.get(`${path.basename(path.dirname(path.dirname(file)))}:${id}`);
}
function ensureOpenclawUnrouted(session) {
  if (openclawRouteKey(session.file, session.rawId, openclawRoutedSessions())) {
    throw Error('该会话仍被 OpenClaw 路由引用，直接移动文件会留下失效入口。请先在 OpenClaw 中结束或移除对应会话；当前文件未移动。');
  }
}
function readOpenclaw(file, routed = openclawRoutedSessions()) {
  let latest = 0; let firstUser = ''; let messages = 0; let cwd = ''; let model = ''; const seen = new Set(); const events = [];
  for (const line of readLines(file)) {
    const x = safeParse(line); if (!x) continue; cwd ||= x.cwd || ''; const t = Date.parse(x.timestamp || ''); if (t > latest) latest = t; if (x.type === 'model_change') model = x.modelId || model;
    const message = x.message; const role = message?.role; const text = cleanText(contentText(message?.content));
    if (role === 'user' && text && !isNoise(text) && !seen.has(text.toLowerCase())) { seen.add(text.toLowerCase()); messages += 1; if (!firstUser) firstUser = text; }
    if (t) {
      if (role === 'user') events.push({ time: t, kind: 'user', role: 'user' });
      else if (role === 'assistant') events.push({ time: t, kind: 'assistant', role: 'assistant' });
      else if (message?.role === 'toolResult' || x.message?.role === 'tool') events.push({ time: t, kind: 'tool_result', role: 'tool' });
      else if (x.type === 'custom' && /error|timeout|failed/i.test(JSON.stringify(x.data || {}))) events.push({ time: t, kind: 'error', role: 'system' });
    }
  }
  const rawId = path.basename(file, '.jsonl'); const route = openclawRouteKey(file, rawId, routed);
  const trashBlockReason = route ? '仍被 OpenClaw 会话路由引用；直接移动文件会留下失效入口。' : '';
  return baseSession('openclaw', file, rawId, cwd || path.join(AGENTS.openclaw.root, 'workspace'), firstUser, messages, latest || fs.statSync(file).mtimeMs, false, { model, events, trashBlockReason, capabilities: { canTrash: !route } });
}
function readPi(file) {
  let latest = 0; let firstUser = ''; let messages = 0; let cwd = ''; let model = ''; let rawId = ''; const seen = new Set(); const events = [];
  for (const line of readLines(file)) {
    const x = safeParse(line); if (!x) continue;
    const t = Date.parse(x.timestamp || x.message?.timestamp || ''); if (t > latest) latest = t;
    if (x.type === 'session') { rawId ||= x.id || ''; cwd ||= x.cwd || ''; continue; }
    if (x.type === 'model_change') { model = x.modelId || model; continue; }
    if (x.type !== 'message') continue;
    const message = x.message || {}; const role = message.role || ''; const text = cleanText(contentText(message.content));
    if (role === 'user' && text && !isNoise(text) && !seen.has(text.toLowerCase())) { seen.add(text.toLowerCase()); messages += 1; if (!firstUser) firstUser = text; }
    else if (role === 'assistant') messages += 1;
    if (t) {
      if (role === 'user') events.push({ time: t, kind: 'user', role: 'user' });
      else if (role === 'toolResult') events.push({ time: t, kind: message.isError ? 'error' : 'tool_result', role: 'tool' });
      else if (role === 'assistant') {
        const blocks = Array.isArray(message.content) ? message.content : [];
        if (message.stopReason === 'error' || message.errorMessage) events.push({ time: t, kind: 'error', role: 'assistant' });
        else if (blocks.some((part) => part?.type === 'toolCall' || part?.type === 'tool_use')) events.push({ time: t, kind: 'tool_call', role: 'assistant' });
        else if (blocks.some((part) => part?.type === 'thinking')) events.push({ time: t, kind: 'thinking', role: 'assistant' });
        else events.push({ time: t, kind: 'assistant', role: 'assistant' });
      }
    }
  }
  if (!rawId) rawId = path.basename(file, '.jsonl').split('_').pop() || path.basename(file, '.jsonl');
  if (!cwd) cwd = HOME;
  return baseSession('pi', file, rawId, cwd, firstUser, messages, latest || fs.statSync(file).mtimeMs, false, { model, events });
}
function readByAgent(agent, file) {
  if (agent === 'codex') return readCodex(file);
  if (agent === 'claude') return readClaude(file);
  if (agent === 'openclaw') return readOpenclaw(file);
  if (agent === 'pi') return readPi(file);
  return null;
}
function allSessions(agent = 'all') {
  const out = [];
  if (agent === 'all' || agent === 'codex') { out.push(...jsonlFiles(path.join(CODEX, 'sessions')).map((f) => readCodex(f)).filter(Boolean)); out.push(...jsonlFiles(path.join(CODEX, 'archived_sessions')).map((f) => readCodex(f, true)).filter(Boolean)); }
  if (agent === 'all' || agent === 'claude') out.push(...jsonlFiles(path.join(AGENTS.claude.root, 'projects')).map(readClaude).filter(Boolean));
  if (agent === 'all' || agent === 'openclaw') {
    const routed = openclawRoutedSessions();
    out.push(...jsonlFiles(path.join(AGENTS.openclaw.root, 'agents')).filter((f) => !/\.(trajectory|checkpoint|reset|deleted)\./.test(path.basename(f))).map((f) => readOpenclaw(f, routed)).filter(Boolean));
  }
  if (agent === 'all' || agent === 'pi') out.push(...jsonlFiles(piSessionsRoot()).map(readPi).filter(Boolean));
  return out.sort((a, b) => Date.parse(b.updated) - Date.parse(a.updated));
}
function conversation(session) {
  const out = []; const seen = new Set();
  for (const line of readLines(session.file)) {
    const x = safeParse(line); if (!x) continue; let role = ''; let text = '';
    if (session.agent === 'codex') { const p = x.payload || {}; if (x.type === 'response_item' && ['user', 'assistant'].includes(p.role)) { role = p.role; text = contentText(p.content); } else if (x.type === 'event_msg' && ['UserMessage', 'AgentMessage'].includes(p.item?.type)) { role = p.item.type === 'UserMessage' ? 'user' : 'assistant'; text = contentText(p.item.content); } }
    else if (session.agent === 'claude' && ['user', 'assistant'].includes(x.type)) { role = x.type; text = contentText(x.message?.content || x.message); }
    else if (session.agent === 'openclaw' && x.type === 'message' && ['user', 'assistant'].includes(x.message?.role)) { role = x.message.role; text = contentText(x.message.content); }
    else if (session.agent === 'pi' && x.type === 'message' && ['user', 'assistant', 'toolResult'].includes(x.message?.role)) { role = x.message.role === 'toolResult' ? 'assistant' : x.message.role; text = contentText(x.message.content); if (!text && x.message?.errorMessage) text = x.message.errorMessage; }
    text = cleanText(text); if (!role || !text || isNoise(text)) continue; const key = `${role}|${text}`; if (seen.has(key)) continue; seen.add(key); out.push({ role, text, timestamp: x.timestamp || '' });
  }
  return out;
}
function readTrashIndex() { try { return JSON.parse(fs.readFileSync(TRASH_INDEX, 'utf8')); } catch { return {}; } }
function writeTrashIndex(index) { fs.mkdirSync(path.dirname(TRASH_INDEX), { recursive: true }); const tmp = `${TRASH_INDEX}.tmp`; fs.writeFileSync(tmp, JSON.stringify(index, null, 2)); fs.renameSync(tmp, TRASH_INDEX); }
function findSession(id, includeTrash = false) {
  const parsed = splitId(id); const found = allSessions(parsed.agent).find((s) => s.id === id || (parsed.agent === 'codex' && s.rawId === parsed.rawId)); if (found || !includeTrash) return found || null;
  const index = readTrashIndex();
  for (const [trashName, meta] of Object.entries(index)) {
    const agent = meta.agent || 'codex'; const rawId = meta.rawId || meta.id; if (namespace(agent, rawId) !== id && !(agent === 'codex' && rawId === parsed.rawId)) continue;
    const file = path.join(TRASH, trashName); if (!fs.existsSync(file)) continue; const session = readByAgent(agent, file);
    if (session) return { ...session, title: meta.title || session.title, id: namespace(agent, rawId), rawId, status: 'trash', runtime: runtimeInfo(agent, [], false, true), trash: true, archived: false };
  }
  return null;
}
function trashSessions(agent = 'all') {
  const index = readTrashIndex(); const out = [];
  for (const [trashName, meta] of Object.entries(index)) {
    const itemAgent = meta.agent || 'codex'; if (agent !== 'all' && itemAgent !== agent) continue;
    const file = path.join(TRASH, trashName); if (!fs.existsSync(file)) continue;
    const session = readByAgent(itemAgent, file); if (session) out.push({ ...session, title: meta.title || session.title, id: namespace(itemAgent, meta.rawId || session.rawId), rawId: meta.rawId || session.rawId, status: 'trash', runtime: runtimeInfo(itemAgent, [], false, true), trash: true, archived: false });
  }
  return out.sort((a, b) => Date.parse(b.updated) - Date.parse(a.updated));
}
function moveToTrash(session) {
  if (session.agent === 'openclaw') ensureOpenclawUnrouted(session);
  fs.mkdirSync(TRASH, { recursive: true }); const ext = path.extname(session.file); const base = path.basename(session.file, ext); let name = `CodexHub-${session.agent}-${base}${ext}`;
  if (fs.existsSync(path.join(TRASH, name))) name = `CodexHub-${session.agent}-${base}-${Date.now()}${ext}`;
  const index = readTrashIndex(); const original = session.file; const target = path.join(TRASH, name);
  const isCodex = session.agent === 'codex'; const snapshotName = isCodex ? `CodexHub-state-${session.rawId}.sqlite` : null;
  const snapshot = snapshotName && path.join(TRASH, snapshotName);
  if (isCodex) { ensureCodexSessionIdle(session.rawId); ensureNoCodexDescendants(session.rawId); codexTrashState('snapshot', session.rawId, snapshot); }
  try {
    if (isCodex) fs.copyFileSync(original, target, fs.constants.COPYFILE_EXCL);
    else fs.renameSync(original, target);
    index[name] = { source: original, snapshot: snapshotName, nativeDeleted: false, originalArchived: session.archived, agent: session.agent, rawId: session.rawId, id: session.id, title: session.title, movedAt: new Date().toISOString() };
    writeTrashIndex(index);
  } catch (error) {
    if (fs.existsSync(target)) { if (isCodex) fs.unlinkSync(target); else fs.renameSync(target, original); }
    if (snapshot && fs.existsSync(snapshot)) fs.unlinkSync(snapshot);
    throw error;
  }
  if (isCodex) {
    try { codexCommand('delete', session.rawId); }
    catch (error) {
      if (codexThreadExists(session.rawId)) {
        if (!fs.existsSync(original)) fs.copyFileSync(target, original, fs.constants.COPYFILE_EXCL);
        delete index[name]; writeTrashIndex(index);
        fs.unlinkSync(target); fs.unlinkSync(snapshot);
        throw error;
      }
    }
    index[name].nativeDeleted = true;
    writeTrashIndex(index);
    try { codexTrashState('remove-catalog', session.rawId, snapshot); }
    catch (error) {
      try { restoreFromTrash(session.id); }
      catch (rollbackError) { throw Error(`已移入废纸篓，但同步 Codex 侧栏失败且自动恢复失败：${error.message}；${rollbackError.message}`); }
      throw Error(`同步 Codex 侧栏失败，已恢复会话：${error.message}`);
    }
  }
  return name;
}
function restoreFromTrash(id) {
  const index = readTrashIndex(); const entry = Object.entries(index).find(([, meta]) => namespace(meta.agent || 'codex', meta.rawId || meta.id) === id || ((meta.agent || 'codex') === 'codex' && (meta.rawId || meta.id) === splitId(id).rawId));
  if (!entry) throw Error('找不到该会话的原始位置记录'); const [trashName, meta] = entry; const source = path.join(TRASH, trashName); if (!fs.existsSync(source)) throw Error('系统废纸篓中找不到该会话文件');
  if (meta.snapshot) {
    const snapshot = path.join(TRASH, meta.snapshot); if (!fs.existsSync(snapshot)) throw Error('找不到 Codex 历史快照，已保留废纸篓文件');
    if (fs.existsSync(meta.source)) throw Error('Codex 原始位置已有同名文件，未覆盖原文件');
    const staged = path.join(CODEX, 'archived_sessions', path.basename(meta.source));
    if (fs.existsSync(staged)) throw Error('Codex 归档位置已有同名文件，未覆盖原文件');
    fs.mkdirSync(path.dirname(staged), { recursive: true });
    fs.copyFileSync(source, staged, fs.constants.COPYFILE_EXCL);
    const rawId = meta.rawId || splitId(meta.id).rawId;
    try {
      codexCommand('unarchive', rawId);
      if (meta.originalArchived) codexCommand('archive', rawId);
      if (!fs.existsSync(meta.source)) throw Error('Codex 未将会话恢复到原位置');
      codexTrashState('restore', rawId, snapshot);
    } catch (error) {
      try {
        ensureNoCodexDescendants(rawId);
        if (codexThreadExists(rawId)) codexCommand('delete', rawId);
        for (const file of [staged, meta.source]) if (fs.existsSync(file)) fs.unlinkSync(file);
      } catch (rollbackError) {
        throw Error(`恢复失败且清理未完成，废纸篓备份仍在：${error.message}；${rollbackError.message}`);
      }
      throw Error(`恢复 Codex 会话失败，废纸篓中的原文件和历史快照仍在：${error.message}`);
    }
    delete index[trashName]; writeTrashIndex(index);
    fs.unlinkSync(source); fs.unlinkSync(snapshot);
    return meta.source;
  }
  let target = meta.archivedSource || meta.source; fs.mkdirSync(path.dirname(target), { recursive: true });
  if (meta.archivedSource && fs.existsSync(meta.source)) throw Error('Codex 原始位置已有同名文件，未覆盖原文件');
  if (fs.existsSync(target)) { if (meta.archivedSource) throw Error('Codex 归档位置已有同名文件，未覆盖原文件'); target = `${target}.restored-${Date.now()}`; }
  fs.renameSync(source, target);
  if (meta.archivedSource) {
    try { codexCommand('unarchive', meta.rawId || splitId(meta.id).rawId); }
    catch (error) { if (fs.existsSync(target)) fs.renameSync(target, source); throw error; }
  }
  delete index[trashName]; writeTrashIndex(index); return meta.archivedSource ? meta.source : target;
}
function codexCommand(command, id) {
  const candidates = [process.env.CODEX_CLI, '/Applications/ChatGPT.app/Contents/Resources/codex', 'codex'].filter(Boolean);
  for (const executable of candidates) {
    const args = [command, ...(command === 'delete' ? ['--force'] : []), id];
    const result = spawnSync(executable, args, { encoding: 'utf8', timeout: 30000 });
    if (result.error?.code === 'ENOENT') continue;
    if (result.error || result.status !== 0) throw Error(`Codex ${command} 失败（${id}）：${(result.stderr || result.stdout || result.error?.message || '未知错误').trim()}`);
    return;
  }
  throw Error('找不到 Codex 命令，无法同步 Codex 会话记录');
}
function ensureCodexSessionIdle(id) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw Error('Codex 会话 ID 无效');
  const lock = path.join(CODEX, 'thread-writer-locks', `${id}.lock`);
  if (!fs.existsSync(lock)) return;
  const probe = 'import fcntl, os, sys\nfd = os.open(sys.argv[1], os.O_RDONLY)\ntry:\n    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)\nexcept BlockingIOError:\n    sys.exit(2)\nfinally:\n    os.close(fd)';
  const result = spawnSync('/usr/bin/python3', ['-c', probe, lock], { encoding: 'utf8', timeout: 5000 });
  if (result.status === 2) throw Error('会话正被 Codex 使用，请先关闭该会话后重试；原文件和历史记录未移动');
  if (result.error || result.status !== 0) throw Error(`无法检查 Codex 会话写入锁：${(result.stderr || result.error?.message || '未知错误').trim()}`);
}
function codexThreadExists(id) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw Error('Codex 会话 ID 无效');
  const db = path.join(CODEX, 'state_5.sqlite');
  const result = spawnSync('/usr/bin/sqlite3', ['-readonly', db, `SELECT count(*) FROM threads WHERE id='${id}'`], { encoding: 'utf8', timeout: 5000 });
  if (result.error || result.status !== 0) throw Error(`无法核对 Codex 会话索引：${(result.stderr || result.error?.message || '未知错误').trim()}`);
  return result.stdout.trim() !== '0';
}
function codexTrashState(command, id, snapshot, originalPath, originallyArchived) {
  const args = [path.join(__dirname, 'codex-trash-state.py'), command, CODEX, id, snapshot];
  if (originalPath !== undefined) args.push(originalPath, originallyArchived ? '1' : '0');
  const result = spawnSync('/usr/bin/python3', args, { encoding: 'utf8', timeout: 30000 });
  if (result.error || result.status !== 0) throw Error(`Codex 历史${command === 'snapshot' ? '备份' : '恢复'}失败：${(result.stderr || result.error?.message || '未知错误').trim()}`);
}
function ensureNoCodexDescendants(id) {
  const db = path.join(CODEX, 'state_5.sqlite');
  if (!fs.existsSync(db)) return;
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw Error('Codex 会话 ID 无效');
  const query = `WITH RECURSIVE descendants(id) AS (SELECT child_thread_id FROM thread_spawn_edges WHERE parent_thread_id = '${id}' UNION SELECT e.child_thread_id FROM thread_spawn_edges e JOIN descendants d ON e.parent_thread_id = d.id) SELECT id FROM descendants`;
  const result = spawnSync('/usr/bin/sqlite3', ['-readonly', '-json', db, query], { encoding: 'utf8', timeout: 5000 });
  if (result.error || result.status !== 0) throw Error(`无法检查 Codex 子会话：${(result.stderr || result.error?.message || '未知错误').trim()}`);
  const descendants = JSON.parse(result.stdout || '[]');
  if (descendants.length) throw Error(`该会话还有 ${descendants.length} 个子会话记录；请先处理子会话，以免 Codex 连带删除其历史`);
}
function deleteFromTrash(id) {
  const index = readTrashIndex(); const entry = Object.entries(index).find(([, meta]) => namespace(meta.agent || 'codex', meta.rawId || meta.id) === id || ((meta.agent || 'codex') === 'codex' && (meta.rawId || meta.id) === splitId(id).rawId));
  if (!entry) throw Error('找不到该会话的废纸篓记录'); const [trashName, meta] = entry; const target = path.join(TRASH, trashName);
  if (meta.agent === 'openclaw') ensureOpenclawUnrouted({ file: meta.source, rawId: meta.rawId || splitId(meta.id).rawId });
  if ((meta.agent || 'codex') === 'codex' && !meta.nativeDeleted) { const rawId = meta.rawId || splitId(meta.id).rawId; ensureNoCodexDescendants(rawId); codexCommand('delete', rawId); }
  if ((meta.agent || 'codex') === 'codex') codexTrashState('remove-catalog', meta.rawId || splitId(meta.id).rawId, meta.snapshot ? path.join(TRASH, meta.snapshot) : target);
  if (fs.existsSync(target)) fs.unlinkSync(target);
  if (meta.snapshot && fs.existsSync(path.join(TRASH, meta.snapshot))) fs.unlinkSync(path.join(TRASH, meta.snapshot));
  delete index[trashName]; writeTrashIndex(index); return trashName;
}
function commandFor(session) {
  if (session.agent === 'codex') return `cd "${session.path}" && codex resume ${session.rawId}`;
  if (session.agent === 'claude') return `cd "${session.path}" && claude --resume ${session.rawId}`;
  if (session.agent === 'pi') return '';
  return '';
}
function json(res, code, data) { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(data)); }
function body(req) { return new Promise((resolve, reject) => { let value = ''; req.on('data', (chunk) => value += chunk); req.on('end', () => { try { resolve(value ? JSON.parse(value) : {}); } catch (error) { reject(error); } }); }); }

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type' }); return res.end(); }
    const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
    if (url.pathname === '/api/agents') {
      const counts = Object.fromEntries(Object.keys(AGENTS).map((key) => [key, allSessions(key).length]));
      return json(res, 200, { agents: Object.entries(AGENTS).map(([id, value]) => ({ id, label: value.label, mark: value.mark, root: value.root, canResume: value.canResume, count: counts[id] })), counts });
    }
    if (url.pathname === '/api/sessions') {
      const requested = url.searchParams.get('agent') || 'all'; const agent = ['all', ...Object.keys(AGENTS)].includes(requested) ? requested : 'all';
      const counts = Object.fromEntries(Object.keys(AGENTS).map((id) => [id, allSessions(id).length]));
      return json(res, 200, { agent, sessions: allSessions(agent), trash: trashSessions(agent), roots: Object.fromEntries(Object.entries(AGENTS).map(([id, x]) => [id, x.root])), agents: Object.entries(AGENTS).map(([id, x]) => ({ id, label: x.label, mark: x.mark, count: counts[id] })) });
    }
    if (url.pathname.startsWith('/api/conversation/')) {
      const id = decodeURIComponent(url.pathname.slice('/api/conversation/'.length)); const session = findSession(id, true);
      if (!session) return json(res, 404, { error: '会话不存在或已移入系统废纸篓' }); if (session.status === 'trash') return json(res, 410, { error: '该会话已移入系统废纸篓，只能恢复后继续使用', session, messages: [] });
      return json(res, 200, { session, messages: conversation(session) });
    }
    if (url.pathname === '/api/health') return json(res, 200, { ok: true, version: 'multi-agent', agents: Object.fromEntries(Object.keys(AGENTS).map((id) => [id, allSessions(id).length])) });
    if (req.method === 'POST' && url.pathname === '/api/action') {
      const b = await body(req); const ids = Array.isArray(b.ids) ? [...new Set(b.ids)] : [b.id].filter(Boolean);
      if (b.action === 'stop-service') {
        json(res, 200, { ok: true, stopping: true });
        setTimeout(() => server.close(() => process.exit(0)), 180);
        return;
      }
      if (b.action === 'empty-trash') { let count = 0; const errors = []; for (const item of trashSessions()) { try { deleteFromTrash(item.id); count += 1; } catch (error) { errors.push(`${item.title}: ${error.message}`); } } return json(res, errors.length ? 500 : 200, { ok: !errors.length, count, error: errors.length ? `已删除 ${count} 个，${errors.length} 个失败：${errors.slice(0, 3).join('；')}` : undefined }); }
      if (b.action === 'bulk-restore') { let count = 0; const errors = []; for (const id of ids) { try { restoreFromTrash(id); count += 1; } catch (error) { errors.push(error.message); } } return json(res, errors.length ? 500 : 200, { ok: !errors.length, count, ids, error: errors.length ? `已恢复 ${count} 个，${errors.length} 个失败：${errors.slice(0, 3).join('；')}` : undefined }); }
      if (b.action === 'bulk-trash') { let count = 0; const errors = []; for (const id of ids) { let session; try { session = findSession(id); if (!session) throw Error('找不到会话，请刷新列表'); moveToTrash(session); count += 1; } catch (error) { errors.push(`${session?.title || id}（${id}）：${error.message}`); } } return json(res, errors.length ? 500 : 200, { ok: !errors.length, count, ids, error: errors.length ? `已移动 ${count} 个，${errors.length} 个失败：${errors.slice(0, 3).join('；')}` : undefined }); }
      if (b.action === 'restore') return json(res, 200, { ok: true, restored: restoreFromTrash(b.id) });
      if (b.action === 'delete-trash') return json(res, 200, { ok: true, deleted: deleteFromTrash(b.id) });
      const session = findSession(b.id); if (!session) return json(res, 404, { error: '会话不存在或已移入系统废纸篓' });
      if (b.action === 'trash') moveToTrash(session);
      else if (b.action === 'archive' && session.agent === 'codex' && !session.archived) codexCommand('archive', session.rawId);
      else if (b.action === 'unarchive' && session.agent === 'codex' && session.archived) codexCommand('unarchive', session.rawId);
      else if (b.action === 'resume') return json(res, 200, { ok: true, command: commandFor(session), cwd: session.path, canResume: session.capabilities.canResume });
      else if (!['trash', 'archive', 'unarchive'].includes(b.action)) return json(res, 400, { error: `${session.agentLabel} 暂不支持该操作` });
      return json(res, 200, { ok: true });
    }
    const file = url.pathname === '/' ? '/index.html' : url.pathname; const target = path.resolve(__dirname, `.${file}`);
    if (!target.startsWith(path.resolve(__dirname)) || !fs.existsSync(target)) return json(res, 404, { error: '文件不存在' });
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }; res.writeHead(200, { 'content-type': types[path.extname(target)] || 'text/plain' }); fs.createReadStream(target).pipe(res);
  } catch (error) { json(res, 500, { error: error.message }); }
});
server.listen(PORT, '127.0.0.1', () => console.log(`Agent Observatory running at http://127.0.0.1:${PORT}`));
