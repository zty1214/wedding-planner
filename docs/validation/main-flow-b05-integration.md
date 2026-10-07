# B05 本轮集成检查

日期2026-10-07，业务基线709f265；独立实施工作树main-flow-acceptance。开发探针仅只读核对，未部署、未迁移、未改权限。

固定playwright@1.62.1与锁文件，新增npm run test:e2e。CI在npm run check后安装Chromium并执行自动浏览器回归，always上传脱敏JSON/截图；实际远端CI尚未触发，不以配置修改当作远端成功。

本轮npm run check退出0：191测试通过/0失败，本地150人及90版本规模、Fusion类型检查、lint、默认构建及虚构Fusion配置构建通过。[完整日志](main-flow-integration-check.log)。浏览器脚本集成后七组再次通过，退出0，详见B04报告。

原方案阶段描述、云端规模范围、T04真机/Excel剩余门槛及S03历史状态已按原证据同步。AGENTS.md从主仓库读取的未提交文件仅供遵循，未纳入本轮交付，避免抢占原会话所有权。

仍未关闭：独立浏览器真实云端协作及故障矩阵、真机/Excel/WPS、实际配额及崩溃组合、同提交远端CI。正式发布门槛继续独立跟踪。
