/**
 * account.snapshot 契约：本机账号快照的脱敏摘要视图。
 *
 * 权限边界（由 Harness 策略层保证）：
 * - 只有可信主人（desktop / qq_private 且 trustedOwner）可读取；
 * - 模型/用户只能看到摘要（段位/白金/杜卡德/现金/物品名称×数量），
 *   绝不包含实例 ID、账号标识、原始快照字段；
 * - 「导出原始快照」在任何渠道都被拒绝。
 */

export const ACCOUNT_SNAPSHOT_CONTRACT_VERSION = '1.0' as const;

export interface AccountSnapshotRequest {
  contractVersion: typeof ACCOUNT_SNAPSHOT_CONTRACT_VERSION;
  /** 可选：只核对指定物品（如「我的库存 古纪V3」）。 */
  item?: string;
}

export interface AccountTotals {
  masteryRank: number;
  platinum: number;
  credits: number;
  ducats: number;
}

export interface AccountSnapshotItem {
  /** 脱敏摘要只含名称与数量，绝不含实例 ID、账号标识或原始字段。 */
  name: string;
  count: number;
}

export type AccountSnapshotFinding = 'confirmed_present' | 'unavailable';

export interface AccountSnapshotEvidence {
  scope: 'personal_snapshot';
  evidenceType: 'local_snapshot';
  asOf: string;
  expiresAt: string;
  freshness: 'fresh' | 'stale';
  finding: AccountSnapshotFinding;
  source: 'synthetic.local' | 'alecaframe.local';
}

export interface AccountSnapshotSuccess {
  contractVersion: typeof ACCOUNT_SNAPSHOT_CONTRACT_VERSION;
  ok: true;
  data: {
    requestedItem?: string;
    totals: AccountTotals;
    /** 模型/用户可见视图：只包含名称+数量摘要。 */
    items: AccountSnapshotItem[];
    snapshotAt: string;
  };
  evidence: AccountSnapshotEvidence;
  warnings: string[];
}

export type AccountSnapshotErrorCode = 'INVALID_REQUEST' | 'SNAPSHOT_UNAVAILABLE' | 'ITEM_NOT_FOUND' | 'INTERNAL_ERROR';

export interface AccountSnapshotFailure {
  contractVersion: typeof ACCOUNT_SNAPSHOT_CONTRACT_VERSION;
  ok: false;
  error: { code: AccountSnapshotErrorCode; message: string; retryable: boolean };
  evidence?: AccountSnapshotEvidence;
}

export type AccountSnapshotResult = AccountSnapshotSuccess | AccountSnapshotFailure;
