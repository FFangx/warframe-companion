/**
 * RunPolicy：单次 Agent run 的预算与停止边界（运行架构设计 9.3 节）。
 *
 * D2a1 只落实循环预算与停止：工具次数、模型请求次数、硬截止时间、
 * finalize 预留、健康/工具/模型请求的分阶段超时与累计 token 预算。
 * maxPlanUpdates / maxProtocolRepairs 属于规划与控制协议（D2c/D2a2），
 * 不在本切片。
 *
 * 预算由主进程构造（桌面默认 DEFAULT_RUN_POLICY，120 秒），renderer 不能
 * 提高预算；`timeoutMs` 作为兼容入口只允许把硬截止时间缩短。模型永远不
 * 能看到或修改预算。初始值全部是待验证的项目初始配置（设计基线），不是
 * 行业通用默认值。
 */
export interface RunPolicy {
  /** 每次真正进入领域工具执行计一次；成功、失败、重试都算。 */
  maxToolAttempts: number;
  /** 每次生成请求都算（含最终汇总）；最后 1 次预留给 finalizing。 */
  maxModelRequests: number;
  /** 从接收 run 开始，包含健康检查、所有工具、模型与最终汇总。 */
  hardDeadlineMs: number;
  /** 软执行截止点 = hardDeadline - finalizeReserve；之后的正常决策不再发起。 */
  finalizeReserveMs: number;
  /** 正常决策的模型请求超时；取配置与阶段剩余时间的较小值。 */
  modelRequestTimeoutMs: number;
  /** 最终汇总模型请求超时（最多 20 秒）。 */
  finalizeRequestTimeoutMs: number;
  /** 健康检查超时；必须贯穿同一 AbortSignal。 */
  healthTimeoutMs: number;
  /** 领域工具执行超时；取领域更严格限制与剩余时间。 */
  toolTimeoutMs: number;
  /** 多轮输入＋输出累计预算；超出后不再发起任何模型请求。 */
  totalTokenBudget: number;
}

/**
 * 默认运行策略（设计值，除工具次数 15 外均为待验证初始配置）。
 * Object.freeze 防止调用方（renderer 路径）无意中改写共享策略对象。
 */
export const DEFAULT_RUN_POLICY: Readonly<RunPolicy> = Object.freeze({
  maxToolAttempts: 15,
  maxModelRequests: 24,
  hardDeadlineMs: 120_000,
  finalizeReserveMs: 20_000,
  modelRequestTimeoutMs: 30_000,
  finalizeRequestTimeoutMs: 20_000,
  healthTimeoutMs: 10_000,
  toolTimeoutMs: 15_000,
  totalTokenBudget: 80_000,
});

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/**
 * 合并调用方覆盖值并落实“不能提高预算”：
 * - 非法或缺失字段回落到默认值；
 * - hardDeadlineMs 不允许超过默认策略（renderer 最多只能写更短测试超时）；
 * - 兼容入口 `timeoutMs` 只允许进一步缩短硬截止时间。
 */
export function resolveRunPolicy(overrides: Partial<RunPolicy> | undefined, timeoutMs: number | undefined): RunPolicy {
  const resolved: RunPolicy = { ...DEFAULT_RUN_POLICY };
  for (const key of Object.keys(DEFAULT_RUN_POLICY) as Array<keyof RunPolicy>) {
    const value = overrides?.[key];
    if (positiveInteger(value)) resolved[key] = value;
  }
  resolved.hardDeadlineMs = Math.min(resolved.hardDeadlineMs, DEFAULT_RUN_POLICY.hardDeadlineMs);
  if (positiveInteger(timeoutMs)) resolved.hardDeadlineMs = Math.min(resolved.hardDeadlineMs, timeoutMs);
  return resolved;
}
