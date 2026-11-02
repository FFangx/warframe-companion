import type { MarketPlatform, MarketQueryRequest } from '@warframe-companion/market-query-contract';

/**
 * Harness 层的模型无关市场范围保证（D2b0 聚焦纠正）。
 *
 * 范围补全与一次选择卡都不能依赖任意 adapter 的输出：
 * - 选择卡：未保存默认范围（defaults 缺平台或跨平台）且消息是自然市场问价时，
 *   在调用任何模型生成之前由 Harness 稳定发出；OpenAI-compatible 等 adapter
 *   返回普通文本（而不是结构化 clarify）也无法绕过该卡。
 * - 归一化：任何 adapter 产生的 market_query 在工具执行前，由程序按
 *   “消息明确条件 → request.defaults → rank 默认 0” 覆盖 platform/crossplay/rank；
 *   模型给错范围不能覆盖用户明确条件或已保存偏好。item 仍由模型或规则解析。
 *
 * 本模块不读写任何偏好存储；偏好写入只发生在主进程（选择卡点击 / 设置页）。
 */

/** 一次范围选择卡上的稳定选项。id 是该卡生命周期内的稳定标识；label 是
 * 渲染标题；platform/crossplay 是规范值，由调用方（主进程）保存为偏好。
 * 推荐项对应 OpenClaw 快捷查询基线 platform=pc, crossplay=true。 */
export interface MarketScopeOption {
  id: string;
  platform: MarketPlatform;
  crossplay: boolean;
  label: string;
  recommended?: boolean;
}

/** 未配置默认交易范围时的一次性选择候选：保持简短（PC 保留跨平台与仅 PC
 * 两个口径，其余平台先按跨平台给出），完整口径可在设置中修改。 */
export const MARKET_SCOPE_OPTIONS: readonly MarketScopeOption[] = [
  { id: 'pc-crossplay', platform: 'pc', crossplay: true, label: 'PC · 跨平台（推荐）', recommended: true },
  { id: 'pc-local', platform: 'pc', crossplay: false, label: 'PC · 仅 PC 交易' },
  { id: 'ps4-crossplay', platform: 'ps4', crossplay: true, label: 'PlayStation · 跨平台' },
  { id: 'xbox-crossplay', platform: 'xbox', crossplay: true, label: 'Xbox · 跨平台' },
  { id: 'switch-crossplay', platform: 'switch', crossplay: true, label: 'Nintendo Switch · 跨平台' },
  { id: 'mobile-crossplay', platform: 'mobile', crossplay: true, label: '移动端 · 跨平台' },
] as const;

/** 选择卡与消息文案；Harness 与桌面主进程共享同一提示，保证事件契约稳定。 */
export const SCOPE_CHOICE_PROMPT = '先选择默认交易范围（推荐 PC 跨平台）。选择后会继续这次查询，并作为之后的默认值。';

/** 消息中明确给出的市场范围。rank 为 null 表示用户明确给出了非法等级
 * （如“负3级”），此时不应把查询静默归一化，而应按规则作文本澄清。 */
export interface ExplicitMarketScope {
  platform?: MarketPlatform;
  crossplay?: boolean;
  rank?: number | 'max' | null;
}

const MARKET_INTENT = /查|查询|价格|行情|多少钱/u;
// 掉落例外：中文“掉落/怎么刷/去哪刷”任意出现即视为掉落查询（保守，不误发卡）；
// 英文 drop/drops 与本地规则 adapter 的 dropItemFrom 同口径（整条消息结尾匹配）。
const DROP_ROUTE = /掉落|怎么刷|去哪刷|^(?:where\s+(?:does|do|can)\s+)?(?:.+?)\s+(?:drop|drops)[?!.]*$/iu;
const PERSONAL_INTENT = /个人库存|我的库存|白金余额|个人白金|我的账号|账号状态|我的遗物|我的赋能/u;
const WRITE_INTENT = /替.*(?:挂|改|删).*单|(?:创建|修改|删除|自动).*订单|发送游戏私聊|给买家发送|自动交易/u;

function platformFrom(message: string): MarketPlatform | undefined {
  if (/\bPC\b/iu.test(message)) return 'pc';
  // “PS4/PS5/PS/PlayStation”都映射到契约平台 ps4（warframe.market 的 PS 平台）。
  if (/\bPS[45]?\b|PlayStation/iu.test(message)) return 'ps4';
  if (/\bXbox\b/iu.test(message)) return 'xbox';
  if (/\bSwitch\b/iu.test(message)) return 'switch';
  if (/移动端|mobile/iu.test(message)) return 'mobile';
  return undefined;
}

function rankFrom(message: string): number | 'max' | undefined | null {
  if (/满级|满阶|\bmax\b/iu.test(message)) return 'max';
  if (/(?:等级\s*)?负\s*[一二三四五六七八九十\d]+|-\d+/u.test(message)) return null;
  const match = message.match(/(?:等级\s*)?(\d+)\s*级|(?:，|\s)(\d+)\s*(?:。|$)/u);
  return match ? Number(match[1] ?? match[2]) : undefined;
}

/** 确定性提取用户本条消息中明确给出的平台 / 跨平台 / 等级。 */
export function marketScopeFromMessage(message: string): ExplicitMarketScope {
  const platform = platformFrom(message);
  // “不跨平台 / 单平台”必须优先于“跨平台”匹配，避免把否定当成肯定。
  const crossplay = /不跨平台|单平台/u.test(message) ? false : /跨平台/u.test(message) ? true : undefined;
  const rank = rankFrom(message);
  return {
    ...(platform ? { platform } : {}),
    ...(crossplay !== undefined ? { crossplay } : {}),
    ...(rank !== undefined ? { rank } : {}),
  };
}

/**
 * 模型无关的自然市场问价判定：有市场问价意图（与本地规则同一口径），且不是
 * 掉落查询、个人查询、写操作请求或寒暄。三类明确例外先排除，避免误触发。
 */
export function isNaturalMarketPriceQuery(message: string): boolean {
  if (!MARKET_INTENT.test(message)) return false;
  if (DROP_ROUTE.test(message)) return false;
  if (PERSONAL_INTENT.test(message)) return false;
  if (WRITE_INTENT.test(message)) return false;
  return true;
}

/** 消息与默认范围合并后是否仍缺平台或跨平台（等级不算，缺省由程序补 0）。 */
export function marketScopeMissing(message: string, defaults?: Partial<MarketQueryRequest>): boolean {
  const scope = marketScopeFromMessage(message);
  const platform = scope.platform ?? defaults?.platform;
  const crossplay = scope.crossplay ?? defaults?.crossplay;
  return platform === undefined || crossplay === undefined;
}

/**
 * Harness 预检：是否需要在调用模型前发一次选择卡。
 * 仅当 askScopeIfMissing 开启、自然市场问价缺平台/跨平台、且消息没有明确
 * 非法等级（非法等级必须先文本澄清，选择卡不能承诺“选择后继续查询”）。
 */
export function scopeChoiceRequired(message: string, defaults: Partial<MarketQueryRequest> | undefined, askScopeIfMissing: boolean | undefined): boolean {
  if (!askScopeIfMissing) return false;
  if (marketScopeFromMessage(message).rank === null) return false;
  if (!isNaturalMarketPriceQuery(message)) return false;
  return marketScopeMissing(message, defaults);
}

/**
 * 程序归一化任何 adapter 产生的 market_query（在工具执行前调用）：
 * platform/crossplay 按 消息明确条件 → request.defaults → 模型给出的值；
 * rank 按 消息明确条件 → request.defaults → 0（缺省不依赖模型遵守提示）。
 * item 保持模型/规则解析结果不变。调用方须先处理消息中的非法等级（rank=null）。
 */
export function normalizeMarketQueryRequest(request: MarketQueryRequest, message: string, defaults?: Partial<MarketQueryRequest>): MarketQueryRequest {
  const scope = marketScopeFromMessage(message);
  return {
    contractVersion: request.contractVersion,
    item: request.item,
    platform: scope.platform ?? defaults?.platform ?? request.platform,
    crossplay: scope.crossplay ?? defaults?.crossplay ?? request.crossplay,
    rank: scope.rank ?? defaults?.rank ?? 0,
  };
}
