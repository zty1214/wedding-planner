# 玫瑰白视觉落地与 V0 验收

日期：2026-10-08。唯一实施现场为 `codex/visual-migration-20261008`，从已验证 `2ac4a5e` 建立；原 feat `709f265` 和用户未提交样板保留。设计参考为本地 main `535542c`、本次 fetch 后 origin/main `1753483`。本阶段统一提交后补同提交 CI；本地报告的 baseline 是提交前 HEAD，实际包含本阶段工作区改动，不能当作旧 SHA 的验收。

## 已落实

- A「玫瑰白」接入真实 Fusion 外壳、四业务页、项目入口、历史和回收站；统一白卡片、深玫瑰主操作、次级文字和表单，手机紧凑四导航及更多菜单。继续使用实际 Repository 状态和计数；Konva 坐标、排座、权限、队列和私有草稿契约未重写。
- 导出、本机草稿、链接管理使用原生模态弹窗；Tab/Shift+Tab 边界循环、Escape 和返回打开按钮已实测。忙碌时沿用原面板关闭限制；Escape 不再误关背景手机菜单。
- CI 产物目录按 run/attempt 隔离，本地默认独立临时目录；显式已存在目录拒绝，上传只匹配本次目录。七组浏览器报告见[本地回归](local-e2e/main-flow-e2e-report.json)，不再上传仓库历史报告。
- 整项目恢复先实际移出甲，把乙排到0号、甲排到1号，再恢复并回读 `tableId/seatIndex`；恢复后的四模块、原回执、新代次唯一性、安全版本唯一性、旧草稿留存且不重发均通过。[真实开发云六组终态](cloud-restore-production/cloud-browser-report.json)。

## 视觉与检查证据

[改造前](before/report.json)和[交付生产构建](production-release/report.json)分别覆盖1280/1440/768/390/320；后者六个项目页面30张、项目入口5张、弹窗15张，均无文档横向溢出。三个弹窗在五尺寸下分别执行18次Tab、18次Shift+Tab以及Escape/焦点返回。链接区域遮罩，不展示凭证。

[150人虚构样本](scale-150-delivery/report.json)：纯本地MemoryStore，15桌/30房、150人、每十人一条长姓名，80段长笔记。五尺寸核对150个出席字段、完整长姓名、末位宾客可达、完整正文一致；截图保留拥挤桌位和房间布局。画布全景用于总览，缩放与选桌继续使用现有交互，不将总览小字冒充真机可读性。

[完整检查日志](integration-check.txt)：194项回归、规模、Fusion类型、lint、两次构建通过。[七组主流程](local-e2e/run.txt)通过。[对比度](contrast-report.json)读取浏览器实际颜色，代表性说明文字4.98、状态6.34、选中导航4.99、主按钮5.71；这是代表项，不宣称覆盖所有文字和图形。

[八组编辑恢复](edit-recovery-production/edit-recovery-report.json)通过，涵盖表单交接/清理失败、未知结果不可放弃、冲突永久放弃、已保存不可撤销以及整组混合草稿留存与下载。补查先发现本地故障控制条被固定侧栏遮挡，随后开发重载清空表单展示；提高测试控制条层级并改为生产构建后全组通过，未删除业务断言。

真实云 SDK 开发预览此前多次在创建/加桌时重开，失败从未计为通过，见[失败摘要](development-preview-failures.json)。只读INVALID_INPUT探针正常；禁止依赖发现的实验未成立，已撤回。改用生产构建后六组全部通过，测试适配器调用应用同一SDK连接，不另开客户端；仅本地测试构建包含故障钩子，正式构建不包含。

## 下一步与边界

1. 同提交CI、审查与阶段集成，交付用户整体观感验收；本机预览为 `http://127.0.0.1:4227/demo`，仅既有虚构示例。
2. 真机触摸/软键盘/切后台/重开/文件保存尚未验收，桌面窄屏截图不替代真机；原生QuotaExceededError仍未闭环，不据此破坏浏览器存储填盘。
3. D1/D2真实备份与试迁前按方案§12确认项目归属、冲突裁决人、受控加密备份位置/保管人和隔离恢复目标；当前无真实数据改写；已准备[备份试迁执行单](../../operations/2026-10-08-backup-migration-execution-sheet.md)，列明已有盘点工具、离线工具缺口及待确认信息。
4. R1候选部署、R2正式冻结迁移切换和R3旧系统退役分别确认具体执行单。每日定时业务快照、图片上传及Excel/WPS专项验证继续延期。

## 候选CI修复

首个阶段提交269d211已推送候选分支，但[首次远端运行](https://github.com/zty1214/wedding-planner/actions/runs/37656837191)在创建job前失败，没有执行测试。产物目录表达式错误地在job级env引用runner.temp；[GitHub上下文限制](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts)仅允许步骤级env使用runner。现将e2e环境变量移到步骤，并在upload的with中使用同一run/attempt路径，仍不匹配仓库旧报告。修复阶段另行提交并验证，不能把首次失败算作通过。

修复提交 `ded153f70a81151c26db79d6f0a7e6fd7502de9f` 的[同提交CI](https://github.com/zty1214/wedding-planner/actions/runs/37657091946)已completed/success；check、test:e2e和本次main-flow-e2e产物上传均成功，见[API证据](ci-report.json)。本地feat已快进到相同SHA；原用户未提交方案与设计在合并后原样恢复并核对哈希，原方案保留为未提交修改。备份在 `/private/tmp/planner-preserved-user-docs-6k4jax_9`。CI及整合结果仅补录工作区，随下一完整阶段提交，不为日志再建碎片提交。
