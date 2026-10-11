# Wedding Planner

备婚助手 - 座位安排 / 宾客名单 / 备婚笔记

## CloudBase 融合实施

当前可用入口：[CloudBase 备婚助手](https://dev-d1gh3jw1gdf06af22-1456231968.tcloudbaseapp.com/)。前端 `9a6cdd0`、业务网关 `ab95ed3` 已部署，宾客、排座、房间统一晚次、文本笔记、协作链接、导出、本机草稿、历史与回收站均已接入真实云端。手机号前导零、按晚用房统计及跨身份协作已有验收证据，手机字号与按钮布局已获使用者确认。

旧 Supabase 的四个项目已迁为独立 CloudBase 项目；2026-10-11只读复核未发现旧源新增或修改。CloudBase 上的后续编辑应保留，不重新导入旧副本覆盖。项目链接包含访问权限，使用页面“复制协作链接”分享给家人；管理链接私下保管，不能写入Git。

本轮发布收尾、备份位置、回退和未完成操作统一见 [2026-10-11发布收尾执行单](docs/operations/2026-10-11-release-closeout.md)。本轮新版迭代已收尾：最新CloudBase加密备份及四个真实项目本机恢复检查已完成，最终归档main/feat CI均通过。2026-10-11用户明确“本轮先完成新版收尾，旧站暂不处理”；旧来源停写与退役延期为后续独立事项，不再阻塞本轮，旧站保持现状。该结论不表示旧系统正式切换和退役全部完成。历史设计见 [融合方案](docs/2026-10-02-planner-fusion-plan.md)，已延期的每日产品快照与图片上传不列为本轮上线前置条件。

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

`.github/workflows/check.yml` 对 PR、main 和 feat/codex 分支运行完整检查、主流程、业务构建隔离及16项反馈浏览器回归，不部署网站。使用Node22.18+；线上源码对应的[CI #37902071459](https://github.com/zty1214/wedding-planner/actions/runs/37902071459)已通过。

CloudBase是本轮交付入口，按 [操作手册](docs/operations/cloudbase-runbook.md) 与 [发布收尾执行单](docs/operations/2026-10-11-release-closeout.md)发布。生产产物使用 `scripts/release/build-business-frontend.mjs` 显式Fusion-only构建，不加载旧Supabase配置。当前main/feat推送只触发检查；GitHub Pages工作流仍是手动入口，保留过渡期双配置要求，不用于本轮正式入口，也不在收尾中触发。

部署后以 `build-info.json`、实际公开文件哈希及网关活跃包核对运行版本。纯验收文档提交无需重新部署运行代码；代码集成版本与实际运行版本分别记录。GitHub仅保留 `main` 与 `feat/planner-cloudbase-fusion` 两个远端分支。
