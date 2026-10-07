# B05 本轮集成检查

日期2026-10-07，业务基线709f265；独立实施工作树main-flow-acceptance。开发探针仅只读核对，未部署、未迁移、未改权限。

固定playwright@1.62.1与锁文件，新增npm run test:e2e。CI在npm run check后安装Chromium并执行自动浏览器回归，always上传脱敏JSON/截图；实际远端CI尚未触发，不以配置修改当作远端成功。

本轮npm run check退出0：191测试通过/0失败，本地150人及90版本规模、Fusion类型检查、lint、默认构建及虚构Fusion配置构建通过。[完整日志](main-flow-integration-check.log)。浏览器脚本集成后七组再次通过，退出0，详见B04报告。

原方案阶段描述、云端规模范围、T04真机/Excel剩余门槛及S03历史状态已按原证据同步。AGENTS.md从主仓库读取的未提交文件仅供遵循，未纳入本轮交付，避免抢占原会话所有权。

仍未关闭：其余故障矩阵、真机/Excel/WPS、实际配额及崩溃组合、同提交远端CI。正式发布门槛继续独立跟踪。

真实云端第二阶段（基线9514d31）已完成B01及B02追加证据，仅新增验收工具/文档/脱敏证据。没有业务代码变化，沿用上阶段191项完整check，本阶段另做脚本语法/lint/差异与文档链接检查；远端同提交CI仍未执行。

故障第二阶段基线f175d82：七组实际UI及46项相关回归、脚本语法/lint通过。见[补充报告](main-flow-recovery-20261007/README.md)。开发云端创建额度已用完，轮换丢响应最终重验保持待验；未修改限流或部署。

进程/下载阶段基线6f6c962：新增六个实际SIGKILL边界及私有下载，第七组文件回读通过；原七组重验通过。最终完整check退出0，191项及规模/类型/lint/两构建日志见[最新集成日志](main-flow-process-20261007/integration-check.txt)。此后仅测试驱动和文档变化、无业务代码变化，语法/lint/diff检查另行执行；尚缺相同最终提交的远端CI。

## 远端 CI 实际结果（2026-10-07）

用户已明确授权将固定提交 `b6dc15e0df43079848273db25181de2ae1378b54` 推送至 `codex/main-flow-acceptance-20261007`。远端回读 SHA 一致；该分支完整包含 `feat/planner-cloudbase-fusion` 的已提交历史及本轮四个阶段提交。没有合并或部署。

[Check planner #1](https://github.com/zty1214/wedding-planner/actions/runs/37600644471) 已完成，结论 **failure**：`npm ci`、`npm run check`、Chromium 安装通过；`npm run test:e2e` 失败；脱敏产物上传步骤通过。[公开 API 回读记录](main-flow-ci-20261007/ci-report.json) 绑定同一 SHA。本地七组通过不能替代这一失败结果，B05 继续未关闭。

具体断言/失败截图仍需读取该次运行日志或产物；公开日志 API 返回403，未登录浏览器要求登录。不根据步骤失败信息推断业务缺陷或修改业务代码。后续先取该次失败证据并复现，再进行必要修复。

Chromium151本地对照：冻结代码首次notes/publish失败，后续三次正常流程通过；两种有限延迟探针未证明原因，临时诊断已清理。见[复现证据](main-flow-ci-20261007/README.md)。远端确切断言待登录取证，不放宽断言、不修改业务代码。

混合队列补验阶段：八组实际浏览器、四模块七条请求重开导出/顺序重放通过；最新完整check192项/0失败及规模、类型、lint、两构建通过，见[集成日志](main-flow-mixed-retention-20261007/integration-check.txt)。CI失败原因仍未确认，不能由本地通过关闭。
