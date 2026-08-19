// DeepSeek 真实远程模型冒烟（人工运行，不是 CI 测试）。
// 验证 OpenAI-compatible adapter 与「工具调用 → 结果回送 → 终态」多轮协议
// 对真实 provider 的兼容性，并输出用量/结束原因/轨迹摘要。
//
// 运行前必须由用户自行设置环境变量 DEEPSEEK_API_KEY：
//   PowerShell:  $env:DEEPSEEK_API_KEY = "..."
//   或永久设置:  setx DEEPSEEK_API_KEY "..."
// 本脚本只检查存在性，不打印、不记录 key 值；不要把 key 发到聊天、代码或记忆文件。
//
// 用法：npm run smoke:live --workspace @warframe-companion/agent-runtime
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createWarframeMarketQueryService } from '@warframe-companion/market-query-service';
import { createWarframeDataService } from '@warframe-companion/warframe-data-service';
import {
  createOpenAICompatibleAdapter,
  createOpenAICompatibleProfile,
  runDesktopAgent,
} from '../dist/index.js';

const KEY_VARIABLE = 'DEEPSEEK_API_KEY';
if (!process.env[KEY_VARIABLE]) {
  console.error(`未检测到环境变量 ${KEY_VARIABLE}。请先在当前终端设置后重试（不要把 key 值发到聊天、代码或记忆文件）。`);
  process.exit(1);
}

const profile = createOpenAICompatibleProfile({
  id: 'deepseek-live-smoke',
  label: 'DeepSeek live smoke',
  model: 'deepseek-chat',
  description: '人工真实模型冒烟；凭据仅引用环境变量。',
  capabilities: {
    text: true, vision: false, nativeTools: true, structuredOutput: true,
    reasoning: false, streaming: true, cancellation: true, contextWindow: 65_536,
  },
  configuration: {
    configVersion: '1.0', baseUrl: 'https://api.deepseek.com', api: 'chat_completions',
    healthCheck: 'models', credential: { kind: 'environment', variable: KEY_VARIABLE }, maxOutputTokens: 1024,
  },
});

const adapter = createOpenAICompatibleAdapter();
const marketQuery = createWarframeMarketQueryService();
const cacheDirectory = await mkdtemp(path.join(tmpdir(), 'warframe-companion-smoke-'));
const dataService = createWarframeDataService({ cacheDirectory });
const context = { channel: 'desktop', trustedOwner: true, now: new Date().toISOString() };

function brief(message) { return message.length > 160 ? `${message.slice(0, 157)}…` : message; }

async function runCase(label, message, requiredTool) {
  let result;
  try {
    result = await runDesktopAgent({
      requestId: `live-smoke-${Date.now()}`, message, modelProfileId: profile.id, context, timeoutMs: 60_000,
    }, {
      marketQuery: (request) => marketQuery.query(request),
      searchDrops: (request) => dataService.searchDrops(request),
      signal: new AbortController().signal,
      profiles: [profile],
      adapters: [adapter],
    });
  } catch (error) {
    console.log(`\n[${label}] 抛错：${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
  const trace = result.trace;
  const calledTool = trace.toolCalls.some((call) => call.name === requiredTool);
  const ok = trace.terminalReason === 'completed' && (!requiredTool || calledTool);
  console.log(`\n[${label}] ${ok ? 'PASS' : 'FAIL'}`);
  console.log(`  decision=${trace.decision} terminal=${trace.terminalReason} conclusion=${trace.conclusion ?? '-'}/${trace.conclusionSource ?? '-'}`);
  console.log(`  tools=${trace.toolCalls.map((call) => call.name).join(',') || '-'} latency=${trace.latencyMs}ms adapterVersion=${trace.adapterVersion ?? '-'}`);
  console.log(`  usage=${trace.usage ? `${trace.usage.promptTokens}/${trace.usage.completionTokens}/${trace.usage.totalTokens}` : '-'} finishReason=${trace.finishReason ?? '-'}`);
  console.log(`  answer=${brief(result.message)}`);
  return ok;
}

console.log('== DeepSeek live smoke ==');
const health = await adapter.checkHealth(profile);
console.log(`health: ${health.available ? 'OK' : 'FAIL'} — ${health.summary}`);
if (!health.available) {
  console.error('模型健康检查失败，冒烟中止（检查网络与凭据引用）。');
  process.exit(1);
}

const results = [];
results.push(await runCase('market round-trip', '查一下古纪V3当前行情，PC 跨平台，0级。', 'market.query'));
results.push(await runCase('drops round-trip', 'Neurodes 哪里掉落？', 'drops.search'));
results.push(await runCase('clarify missing scope', '帮我查一下示例 Prime 的价格。', null));

const passed = results.filter(Boolean).length;
console.log(`\n== done: ${passed}/${results.length} passed ==`);
process.exit(passed === results.length ? 0 : 1);
