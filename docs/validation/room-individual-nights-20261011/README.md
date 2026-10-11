# 2026-10-11逐人住宿晚次发布记录

当前前端和网关均为`97d99fdf01f39876c431338e9deec76ec288ab32`，运行在已授权的CloudBase环境。此次替代此前统一房间晚次：每位宾客独立选择日期，房间日期由入住人日期合并得出，用房和人数按晚计算；不支持同一人逐晚换房。

备注移到房卡底部并增加标签、边框和多行输入；删除冗余调整入口；新房仍按房型顺延编号，弹窗保留日期、搜索、选人及一次确认。添加人不修改已有入住人，删除或修改个人晚次不影响同房其他人。既有个人日期无需迁移；旧冻结统一晚次请求保留原意并明确提示。

- [同提交CI](remote-ci.json)：完整检查264项、主流程、业务构建及16项反馈套件全部通过。
- [部署范围](deployment-report.json)、[打包及旧站备份](package-report.json)、[活跃网关代码/配置](gateway-readback.json)、[7个公开文件实际HTTP字节](hosting-readback.json)。
- [实际云端10项](cloud-browser-report.json)：新建独立虚构项目，确认同房不同晚次、只改一人、备注刷新保持、按晚1房1人、导出日期矩阵和独立390px会话；Supabase请求0。仅桌面浏览器窄屏模拟，实际手机观感及触摸仍待反馈。
- [首轮云端失败](cloud-browser-first-attempt.json)保留：点击日期后立即断言，尚未等待异步日期状态变化。验收工具改为等待预期aria-pressed和保存按钮恢复，再刷新核对；未因该失败修改产品源码。首轮没有记录完整断言栈，不将该解释升级为已证明唯一根因。
- [本地演练首轮](release-entry-first-attempt.json)保留：嵌套has选择器范围不正确，改为相对宾客行选择器后演练通过。[最终正式工具演练](release-entry-final.json)。

发布验收工具为`scripts/release/verify-reused-dev-browser.mjs`，默认真实CloudBase网址，仅创建虚构项目；`--local-fixture`配合RELEASE_ACCEPTANCE_ORIGIN可先演练。每次使用新的输出目录，失败后先检查报告，不能盲目重跑以免创建多余项目。

环境加密备份见[报告](environment-backup.json)。原Hosting7文件、网关源码和配置位于仓库外私有备份目录`/Users/baojie/.local/share/wedding-planner-backups/2026-10-11-guest-nights/`；密钥单独保管。回退应先核对当前个人日期数据，再恢复gateway-code及原配置、hosting目录，核对活跃哈希和网页；无需用旧数据库覆盖新版编辑。旧前端按统一晚次呈现，回退时不能据旧界面批量覆盖个人日期。

本次没有写入任何既有真实婚礼项目，没有重导入、改权限、重部署保留任务或处理旧Supabase站。代码交付及运行版本分别记录；后续纯发布证据提交不改变上述运行源码。
