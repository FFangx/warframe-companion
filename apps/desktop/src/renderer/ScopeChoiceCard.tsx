import type { MarketScopeOption } from '@warframe-companion/agent-runtime';
import { Icon } from './Icon.js';

export interface ScopeChoiceState {
  questionId: string;
  prompt: string;
  options: readonly MarketScopeOption[];
  /** 已选中项（成功保存后标记）；null 表示尚未选择。 */
  chosenId: string | null;
  /** 正在保存范围并重跑原查询。 */
  pending: boolean;
  error: string | null;
  /** 被更新的选择卡替代后不可再执行。 */
  superseded: boolean;
}

export function createScopeChoiceState(questionId: string, prompt: string, options: readonly MarketScopeOption[]): ScopeChoiceState {
  return { questionId, prompt, options: [...options], chosenId: null, pending: false, error: null, superseded: false };
}

export function ScopeChoiceCard({ choice, disabled, onChoose }: {
  choice: ScopeChoiceState;
  disabled: boolean;
  onChoose: (option: MarketScopeOption) => void;
}) {
  if (choice.superseded) {
    return <section className="scope-choice scope-choice--superseded" aria-label="默认交易范围选择（已失效）">
      <div className="scope-choice__heading"><span className="scope-choice__icon"><Icon name="market" /></span><div><strong>默认交易范围</strong><p>{choice.prompt}</p></div></div>
      <p className="scope-choice__note">这张选择卡已被更新的选择卡替代，请使用最新的一张。</p>
    </section>;
  }
  const chosen = choice.chosenId ? choice.options.find((option) => option.id === choice.chosenId) : undefined;
  const blocked = disabled || choice.pending || Boolean(chosen);
  return <section className="scope-choice" aria-label="默认交易范围选择">
    <div className="scope-choice__heading"><span className="scope-choice__icon"><Icon name="market" /></span><div><strong>默认交易范围 · 一次配置</strong><p>{choice.prompt}</p></div></div>
    <div className="scope-choice__options">
      {choice.options.map((option) => (
        <button type="button"
          key={option.id}
          className={option.recommended ? 'scope-choice__option scope-choice__option--recommended' : 'scope-choice__option'}
          disabled={blocked}
          aria-pressed={chosen?.id === option.id}
          onClick={() => onChoose(option)}>
          <span>{option.label}</span>
          {option.recommended ? <small>推荐</small> : null}
          {chosen?.id === option.id ? <em>已选择</em> : null}
        </button>
      ))}
    </div>
    {choice.pending ? <p className="scope-choice__note" role="status">正在保存范围并继续查询…</p> : null}
    {choice.error ? <p className="preview-feedback preview-feedback--bad" role="alert">{choice.error}</p> : null}
  </section>;
}
