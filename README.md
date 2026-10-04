# Wedding Planner

备婚助手 - 座位安排 / 宾客名单 / 备婚笔记

## CloudBase 融合实施

按 [融合方案](docs/2026-10-02-planner-fusion-plan.md) 分阶段推进，当前进入 P1c：新 `/fusion` 支持创建独立项目，`/fusion/p/:projectId` 测试入口已接通宾客、排座、住宿及文本笔记四页；旧入口仍使用原数据路径。新内核尚未连接生产页面。回收与换座已通过隔离云函数验证，回收站入口已接入但完整页面验收待补；手动版本保存和预览已接入，自动日快照、整项目恢复及离线冲突处理仍在实施，详见开发验证记录。

- `npm ci`：按锁文件安装依赖。
- `npm run test:fusion`：只读盘点、回执/权限事务、草稿重启和 SDK 边界测试（Node 22.18+；当前实测 Node 25.8.1）。
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
