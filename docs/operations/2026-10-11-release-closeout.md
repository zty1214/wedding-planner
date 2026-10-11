# 2026-10-11发布收尾执行单

状态：本轮新版迭代收尾完成。代码已集成main，最终归档main/feat CI均通过，当前数据加密备份及本机恢复核对已完成，CloudBase已可供家人使用。2026-10-11用户明确“本轮先完成新版收尾，旧站暂不处理”；旧站停写、最终切换和退役延期为后续独立事项，不再阻塞本轮。旧站保持现状，本次不登录Supabase管理后台、不修改旧源权限或删除数据；保留当前CloudBase编辑，不通过重导入“刷新”真实名单。

## 后续住宿交互补充发布

当前最新前端和网关均为`97d99fd`：备注置底、简洁选人/日期弹窗、每位宾客独立晚次。此次明确替代此前房间统一晚次；添加人和改日期不覆盖其他人，每晚统计与导出按个人日期计算。同提交[CI #38126915986](https://github.com/zty1214/wedding-planner/actions/runs/38126915986)、活跃网关包/原配置、Hosting7文件HTTP哈希及实际云端10项通过。测试仅新建虚构项目，既有真实婚礼与旧站不变，实际手机反馈仍待确认。[完整发布及回退记录](../validation/room-individual-nights-20261011/README.md)。

此前前端afa0baf/网关ab95ed3的统一晚次补充及下文9a6cdd0收尾记录保留为历史快照，不代表当前运行版本。最新发布前已另做全环境加密备份和原Hosting/网关代码备份。

## 目标与验收

| 项目 | 结果与边界 |
| --- | --- |
| 使用入口 | https://dev-d1gh3jw1gdf06af22-1456231968.tcloudbaseapp.com/ ，Fusion-only |
| 前端源码 | 9a6cdd0ff5abd03dfd5928792b6249bd1a853f02 |
| 网关源码/活跃包 | ab95ed38f3c50016c84cf940d4579053fa403685 / f4080bc4d651ce22d09037396ffffbc61ae049d30854cddc58147a81fe77d489 |
| 环境/地域 | dev-d1gh3jw1gdf06af22 / ap-shanghai，沿用已授权环境，不购买新环境 |
| 函数/业务集合 | planner-fusion-gateway / planner_fusion_preprod_{access,current,receipts,activity} |
| 自动化 | 260项完整检查、主流程、业务构建、16项反馈回归；线上源码同提交CI #37902071459成功 |
| 云端证据 | 实际网页7项通过且Supabase请求0；两独立身份6项与四集合20项访问拒绝见[网关阶段](../validation/user-feedback-cloud-release-20261008/README.md) |
| 视觉验收 | 10月11日用户“没问题”，关闭本次手机字号、按钮换行和页面布局反馈 |
| 新鲜复核 | 10月11日7个公开文件哈希与已验收产物一致，见[Hosting回读](../validation/release-closeout-20261011/hosting-readback.json) |

手机Safari/Android及文件保存、后台重开等未明确实测的设备场景保留覆盖缺口，不将使用者视觉确认扩大为全部真机测试。当前没有据此新增功能或要求购买环境。

## 数据批次与来源决策

10月8日已迁入四个独立项目：主来源134宾客/12桌/14房，其余来源分别为1宾客、1桌、2桌。私人项目映射和两类访问链接仍在本机受控目录，不写入此公开执行单。主来源配置缺口及补充依据见[迁移报告](../validation/supabase-trial-migration-20261008/README.md)。

10月11日四个Supabase来源重新完整导出，两遍一致，逐记录对比10月8日备份均零差异；[脱敏对账](../validation/release-closeout-20261011/supabase-source-audit.json)。本次只读，没有冻结源写入，不能称最终冻结快照。CloudBase当前数据保留，不重新导入，不改房号，不自动合并其余项目。

当前CloudBase主婚礼已为134宾客/11桌/15房、snapshotRevision=31，已包含迁移后编辑；与旧来源134宾客/12桌/14房不同不是漏迁，禁止用旧来源覆盖。旧weddings来源与10月8日备份也一致。最终切换拟以已使用的CloudBase主婚礼项目为持续编辑入口。若停写前旧源再次出现变化，先做差异裁决，禁止旧数据覆盖新数据；仅凭updated_at不足以判定增量。未同步本机草稿须在对应设备核对，云端导出不能证明设备没有草稿。

## 备份、保管与恢复

- 新Supabase加密备份：`/Users/baojie/.local/share/wedding-planner-backups/2026-10-11-release-closeout/supabase/`，四份均磁盘解密认证及分页校验通过。
- 最新CloudBase全环境备份：用户确认`tcb login`后重试成功。10个数据库集合共1786文档、4个云存储文件共2718字节及4份函数配置；两次完整采集一致，磁盘AES-GCM认证和存储文件hash通过。[备份摘要](../validation/release-closeout-20261011/environment-backup.json)保留首次登录失效与恢复过程。
- 上次完整CloudBase材料：`/Users/baojie/.local/share/wedding-planner-backups/2026-10-08-ab95ed3/dev-environment.json.enc`；本轮新备份目标为同根`2026-10-11-release-closeout/environment.json.enc`。
- 密钥分开存于`/Users/baojie/.local/share/wedding-planner-backup-keys/`，文件600、目录700。保管者为本机用户；真实名单、配置、凭证、密钥、实际名单截图不进入Git。
- 独立备份包含数据库完整分页、云存储文件和函数配置；不包含认证用户、数据库索引定义、函数代码包和完整静态托管。运行源码/包与Hosting备份另有版本记录。
- 已从新备份派生四个独立项目恢复材料，执行本机隔离内存目标prepare/import/verify/publish及重复publish，逐文档JSON全部字段和值一致；不回写云端。[恢复检查](../validation/release-closeout-20261011/backup-recovery.json)。项目JSON格式按既有契约将Int32包装表示为同值数字，全环境材料另保留canonical EJSON；不声称项目JSON副本保留BSON包装类。实际异环境云端恢复尚未演练，不能声称已经验证恢复时间或可接受丢失时间。
- 观察期人工维护建议：每周一次独立加密备份，批量危险操作前加做一次；保留最近四周及切换前材料，不自动删除。该频率是操作建议，未创建定时器或提醒，未声明已运行。恢复职责与异机密钥保管仍需落定，见[恢复手册](disaster-backup-recovery.md)。

## Git集成与入口

验收与对账归档提交f9f4db5已原子快进推送main及现有迁移feat，本地主main/feat已同步，无关文件内容hash保持不变；不改写已有历史，不增加远端分支。main完整CI #38113515371成功；同提交feat首次CI在历史脚本第24行等待宾客草稿提示超时，完整检查/主流程/业务构建均成功，失败保留在[首次集成CI](../validation/release-closeout-20261011/integration-ci-first-attempt.json)。同脚本本地正常运行及6倍CPU/250ms历史恢复延迟均通过，未复现同一超时，不猜测根因或修改产品源码；[调查范围](../validation/release-closeout-20261011/ci-history-investigation.json)。最终备份收尾归档f8adfb125d82b07297494517910087b779a2c153已同步两分支；[main CI #38114281408](https://github.com/zty1214/wedding-planner/actions/runs/38114281408)和[feat CI #38114281361](https://github.com/zty1214/wedding-planner/actions/runs/38114281361)均completed/success。此前首次失败记录继续保留，根因仍未证实，不将后续通过写成已修复该超时。用户主目录未提交的发布方案和原型文件按内容hash保留，旧c888工作树不参与集成。

合并main只触发检查，GitHub Pages为手动发布；本轮不触发Pages、不以过渡期双配置产物替换CloudBase站点。10月11日再次下载实际活跃网关代码，SHA256与既有验收包一致，已保存在本次备份目录gateway-code；[网关回读](../validation/release-closeout-20261011/gateway-readback.json)。实际网页保持9a6cdd0，归档提交不改变业务源码，源码运行版本与归档main版本分别记录。

## 入口复核与分享

2026-10-11再次检查：新版首页HTTP 200，build-info仍为前端9a6cdd0和网关ab95ed3。使用全新Chromium会话打开本机保存的主婚礼完整协作链接，项目成功打开且Supabase请求0；另一个全新会话打开不含`#key=`的相同地址，出现项目无法打开提示。[脱敏结果](../validation/release-closeout-20261011/project-link-readback.json)。尚未收到用户此次失败的原始链接，以上对比不能证明用户本次失败一定由凭证缺失造成。

项目打开后地址栏会移除凭证，不能用地址栏里的普通地址作为跨设备入口。应通过“我的项目”的“复制协作链接”分享，或使用本机仓库外受控目录中的“分享给未婚妻.html”复制完整协作链接；负责人管理链接另行保管。不将任何实际项目ID或访问凭证写入Git。本次未轮换链接、未修改名单或旧站。

## 已延期的旧站事项

用户已决定本轮不处理旧站。以下事项属于未来独立切换任务，须在用户重新要求处理时再执行；本次不发起Supabase管理员登录，不冻结旧源写入、不退役旧站。

1. 对本次主婚礼对应旧来源实施后端停写，保留其余独立项目，验证已打开旧页面写入被拒绝。公开读取配置不能实施RLS变更，前端提示也不能冒充停写。
2. 停写后重新核对旧源与各设备本机草稿，记录最终窗口、目标项目和批次，再决定退役范围。当前备份是未停写的只读快照；CloudBase已有后续编辑，不默认重新导入旧源。

## 后续运行维护与验证覆盖

以下保留为运行维护建议和已知验证边界，不代填为已完成，也不在本轮继续扩展任务：

- 落定独立备份执行、异机密钥保管和实际异环境云端恢复演练；目前仅完成本机隔离恢复核对，未验证云端恢复时间。
- 建议观察保存失败、冲突、备份失败和资源费用7天；环境续费及费用由使用者管理。现有创建上限200用于家庭受控使用，未扩大为公共服务防滥用策略。
- 手机Safari/Android、文件保存和后台重开等未明确实测的场景仍保留覆盖缺口；使用者已确认本次手机字号、按钮和布局反馈。
- 到期历史清理工具已实现，管理员清理未执行，未创建定时器，不自动删除数据。每日产品快照、图片上传、Excel/WPS专项验证继续延期。

本次用户范围确认仅更新收尾记录，不修改运行代码、重新部署或写入数据库。工程与备份归档已提交；用户随后明确要求将本次范围确认文档统一提交并推送，按一次完整收尾文档提交执行，旧站保持不变。

## 回退

网页回退仅恢复已有Hosting公开文件或重新部署已验收包，使用safe/verify、不prune，并核对build-info和逐文件哈希；不随网页回退恢复数据库。当前版本出现故障优先保留数据修复，旧版不保证支持最新房间统一晚次等契约。

数据回退须先限制新写入、备份现状、确定恢复范围和检查新变更能否保留；本执行单不授权用旧快照覆盖当前CloudBase项目。旧Supabase与weddings数据保留，未删除、未自动退役。故障处理由本机用户指定操作并记录脱敏结果，不记录姓名、电话和访问凭证。
