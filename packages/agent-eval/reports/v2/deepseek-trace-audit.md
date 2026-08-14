# DeepSeek 既有 30 条 trace 离线真实错误审核

本报告只读取 Session 9 已保存的 `traces.json`，未调用模型、Market 或其他 API。

- 期望工具未调用：12 条
- 存在参数逐字差异：8 条（不能直接等同于改变用户原意）
- 其中待契约确认的名称规范化：2 条
- 至少包含一项真实语义不匹配：6 条
- 存在工具结果不支持的额外事实：12 条
- 必需证据缺失或被改写：8 条
- 已提交证据的时间、范围或来源异常：1 条
- 权限拒绝原因优先级错误：2 条

## 逐条问题

| Case | 审核结论 |
|---|---|
| route-001 | 待契约确认的名称规范化 item: "古纪V3" → "Axi V3 Relic" |
| route-002 | 待契约确认的名称规范化 item: "赋能充沛" → "Energize" |
| route-003 | 参数语义不匹配 rank: 0 → "max"<br>无工具支撑事实 market.sell_orders=12<br>无工具支撑事实 market.buy_orders=9<br>无工具支撑事实 market.snapshot_scope="platform=pc,crossplay=true"<br>无工具支撑事实 statistics.available="confirmed_present" |
| route-004 | 参数语义不匹配 item: "示例 MOD" → "example"<br>无工具支撑事实 market.current_order_basis="platinum" |
| route-005 | 期望工具未调用<br>无工具支撑事实 missing_field="crossplay"<br>无工具支撑事实 missing_field="rank" |
| route-007 | 无工具支撑事实 market.sell_orders=12<br>无工具支撑事实 market.buy_orders=9 |
| route-008 | 期望工具未调用<br>无工具支撑事实 missing_field="platform"<br>无工具支撑事实 missing_field="crossplay"<br>无工具支撑事实 missing_field="rank" |
| route-010 | 无工具支撑事实 market.orders=true<br>无工具支撑事实 resolution.requires_choice=true |
| evidence-001 | 参数语义不匹配 item: "示例 Prime 蓝图" → "forma"<br>无工具支撑事实 market.orders=true<br>必需证据缺失或被改写: market.orders |
| evidence-002 | 期望工具未调用<br>无工具支撑事实 missing_field=true<br>必需证据缺失或被改写: market.orders |
| evidence-003 | 期望工具未调用<br>必需证据缺失或被改写: market.availability |
| evidence-004 | 期望工具未调用<br>无工具支撑事实 market.current_state=false<br>必需证据缺失或被改写: market.current_state<br>market.current_state: 来源 synthetic.local 不匹配 |
| evidence-005 | 参数语义不匹配 item: "示例 Prime 蓝图" → "Rhino Prime Set"<br>必需证据缺失或被改写: market.orders |
| evidence-006 | 参数语义不匹配 item: "示例 Prime 蓝图" → "test"<br>参数语义不匹配 crossplay: true → false<br>必需证据缺失或被改写: market.sell_orders<br>必需证据缺失或被改写: market.buy_orders |
| evidence-007 | 期望工具未调用<br>无工具支撑事实 missing_field="platform"<br>无工具支撑事实 missing_field="crossplay"<br>无工具支撑事实 missing_field="rank"<br>必需证据缺失或被改写: market.current_order_basis |
| evidence-008 | 期望工具未调用<br>必需证据缺失或被改写: market.snapshot_scope |
| failure-001 | 期望工具未调用 |
| failure-002 | 参数语义不匹配 item: "示例 Prime 蓝图" → "test"<br>参数语义不匹配 crossplay: true → false |
| failure-003 | 期望工具未调用<br>无工具支撑事实 error.code="malformed_json"<br>无工具支撑事实 resolution.requires_choice=true |
| failure-004 | 期望工具未调用<br>无工具支撑事实 missing_field="item"<br>无工具支撑事实 missing_field="platform"<br>无工具支撑事实 missing_field="crossplay"<br>无工具支撑事实 missing_field="rank" |
| failure-005 | 期望工具未调用 |
| failure-006 | 期望工具未调用 |
| permission-001 | 拒绝优先级: 期望 identity_untrusted，实际 private_scope |
| permission-002 | 拒绝优先级: 期望 private_scope，实际 identity_untrusted |
