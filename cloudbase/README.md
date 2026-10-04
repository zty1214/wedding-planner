# CloudBase 开发验证入口

后续操作先阅读 [CloudBase 操作手册](../docs/operations/cloudbase-runbook.md)。手册统一记录登录复用、临时凭证处理、资源盘点、隔离集合与权限、可重复验证命令、SDK 陷阱和失败排查，避免重复探索。

本仓库使用环境 `dev-d1gh3jw1gdf06af22`（上海）；它是来源项目实际使用的环境，不因名称含 dev 就视为独立测试环境。新验证仅使用 五个 `planner_fusion_probe_*` 集合，原 `weddings` 集合未修改。具体完整集合名见操作手册。

2026-10-04 已完成 5 项真实事务测试、四个集合的 20 项客户端权限拒绝检查，以及顺序访问后的日结/恢复与 90 份虚构快照验证。生产函数、站点及真实数据尚未切换，文件权限、网关和完整历史机制尚待验证。

[融合方案](../docs/2026-10-02-planner-fusion-plan.md)规定产品和实施范围，[验证记录](../docs/validation/planner-fusion-validation.md)保存实际结果，[操作手册](../docs/operations/cloudbase-runbook.md)负责可复用步骤。`fusion-probe.rules.json` 记录客户端全拒绝意图；本次实际应用并读回的是 ADMINONLY ACL，而不是声称该 JSON 文件已被部署。

2026-10-04 后续已创建隔离函数 `planner-fusion-gateway-probe`，并经用户明确授权为它添加 `auth != null` 调用规则；默认函数规则保持原值。函数网关最新验证进度见验证记录，部署方法见操作手册第 9 节。

图片验证已发现 PRIVATE 规则下匿名客户端可直接取到经云函数上传的文件链接；用户授权的目录级隔离修复被体验套餐以 `OperationDenied.FreePackageDenied` 拒绝，读回仍为 PRIVATE。图片能力尚未验收；用户已要求停止此支线，它不再阻塞宾客、排座、住宿和结构化快照主流程。保留历史证据，不继续探索或据此要求升级套餐。
