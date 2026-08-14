# Warframe Companion Desktop

Session 4 的最小 Electron/React 桌面壳。当前只提供系统健康页，不包含市场查询 UI、Agent 对话或个人数据视图。

## 开发

```powershell
npm run start -w @warframe-companion/desktop
npm run build -w @warframe-companion/desktop
```

健康页默认探测 `127.0.0.1:18789` 的 OpenClaw Gateway 和 Warframe.Market 公共接口。WFInfo 与 AlecaFrame 不猜测本机安装路径，可通过以下环境变量显式配置：

- `WARFRAME_COMPANION_WFINFO_EXE`
- `WARFRAME_COMPANION_ALECAFRAME_DIR`
- `WARFRAME_COMPANION_OPENCLAW_HOST`
- `WARFRAME_COMPANION_OPENCLAW_PORT`
- `WARFRAME_COMPANION_BUILD_ID`

所有探针只读；renderer 仅能通过 preload 暴露的 `system.getHealth()` 调用类型化 IPC，未启用 Node 集成。
