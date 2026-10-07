# Wedding Planner

备婚助手 - 座位安排 / 宾客名单 / 备婚笔记

## CloudBase 融合实施

按 [融合方案](docs/2026-10-02-planner-fusion-plan.md) 分阶段推进，当前进入 P1c：新 `/fusion` 支持创建独立项目，`/fusion/p/:projectId` 测试入口已接通宾客、排座、住宿及文本笔记四页；旧入口仍使用原数据路径。新内核尚未连接生产页面。回收与换座已通过隔离云函数验证，回收站入口已接入但完整页面验收待补；手动版本、整项目恢复、安全快照、自动日结和筹备日历已接入隔离验证；日历支持按日分类和版本筛选。本机命令草稿支持查看、导出和核对后整组放弃；未发布文本笔记支持自动本机保存与刷新恢复。到期清理已本地实现未部署；宾客、笔记、标题/桌名/房号草稿与确认缓存已持久化。完整冲突处理、真实环境故障与云端容量、手机及页面验收仍待完成，详见开发验证记录。

- `npm ci`：按锁文件安装依赖。
- `npm test`：运行当前 Node test 领域/Repository 回归。
- `npm run check`：顺序运行测试、150 人/90 天规模场景、融合类型检查、lint 和构建；与 CI 使用同一入口。
- `npm run test:fusion`：只读盘点、回执/权限事务、草稿重启和 SDK 边界测试（Node 22.18+；当前实测 Node 25.8.1）。
- `npm run test:scale`：纯本机 150 人、12 篇笔记、90 天日结/历史分页/恢复与 XLSX 回读验收；不访问云环境。
- `npm run typecheck:fusion`：严格检查新增客户端、服务端及测试代码。
- `npm run build`、`npm run lint`：现有应用构建与静态检查。

来源盘点工具不修改云端；仅输出脱敏统计与异常码，写入已存在文件时拒绝覆盖：

```sh
# 发现来源项目及各表数量，不读取姓名、电话和正文
node --env-file=.env.local scripts/fusion/discover-supabase.mjs /private/tmp/planner-discovery.json
# 已核对的单个项目：检查记录引用、晚次、图片字段与体积
npm run inventory:planner -- <project-id> /private/tmp/planner-inventory.json
# 已有受控离线导出：五张表分别为同名数组
node scripts/fusion/inventory.mjs /private/tmp/private-bundle.json <project-id> /private/tmp/planner-inventory.json
```

这些读取不构成停写后的一致备份；完整迁移仍需浏览器本地配置、来源归属核对及正式冻结；图片上传/迁移已按用户要求延后，不阻塞结构化主流程。进展、实测结果与阻塞见 [验证记录](docs/validation/planner-fusion-validation.md)，云端资源边界见 [CloudBase 说明](cloudbase/README.md)。

后续 CloudBase 操作直接参考 [操作手册](docs/operations/cloudbase-runbook.md)：包含登录复用、环境盘点、临时凭证、隔离测试命令及已实测的 SDK/事务问题。

## 检查与受控发布

`.github/workflows/check.yml` 对 PR、main 和 feat/codex 分支运行锁文件安装及 `npm run check`，不连接云环境或部署。工作流使用 Node 22；当前本地验证版本单独记在验证记录，不能等同于远端 CI 已通过。

GitHub Pages 已在工作流文件中改为手动发布：选择 main，并填入已审核的完整提交 SHA，必须与本次执行的 SHA 完全一致。构建前要求仓库变量 `VITE_FUSION_ENV_ID`、`VITE_FUSION_FUNCTION`、`VITE_FUSION_PUBLISHABLE_KEY` 以及过渡期旧入口的 `VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY` 全部存在；这里只允许前端可公开配置，禁止填写管理密钥。缺失配置停止，不回退其他环境。

部署作业绑定 `github-pages` 环境；环境审批人和其他托管平台的自动发布仍须在实际平台核对，仓库修改不代表已配置远端保护。构建产物包含 `build-info.json`，记录提交、工作流运行、CloudBase 环境和函数名，不含访问密钥。正式发布仍需完成 [TODO](docs/planner-fusion-todos.md) 的 R01–R03，不能仅凭检查通过上线。
