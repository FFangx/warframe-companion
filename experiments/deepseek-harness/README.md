# DeepSeek Harness 隔离评估实验

该目录是 Warframe Companion 的旁路实验，不进入桌面生产依赖。它针对固定 DSH 提交 `47f943859bef60e4160492346772ded9b24f765a`，通过正式 Cordis 工具、门禁和事件扩展点，把同一 30 条合成评估转换为既有 `AgentTrace`。

边界：

- `market_query` 只返回合成、脱敏的只读 Market fixture，并映射为逻辑 `market.query`。
- 可信身份来自每条 eval case 的驱动器闭包，不由模型参数声明。
- 权限负例挂载只会被 guard 拒绝的代理工具，不连接个人数据或写实现。
- `submit_agent_trace` 只提交模型的 decision/facts/refusalReason，并调用 `concludeTurn()`；toolCalls 与 latency 由正式事件派生。
- 不解析 headless stdout，不启用 shell、文件、Web、subagent、workflow、skill 或自修改插件。

安装和 keyless 验证：

```powershell
npm install
npm test
```

根包必须已经构建，固定 DSH 同级副本也必须已按基线构建。真实模型评估只检查 `DEEPSEEK_API_KEY` 是否存在，不输出值：

```powershell
npm run build --prefix ..\..
npm run eval
```

无凭据时命令不会发起模型请求，会生成 `reports/comparison.json` 与 `comparison.md` 的明确阻塞记录并返回非零状态；不得把该记录称为模型成绩。凭据存在时才生成逐 case `traces.json`、模型基线和三方对比报告。
