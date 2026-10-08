# 离线转换、全量对账和隔离试迁批次

2026-10-08实现。依据[发布计划](../2026-10-08-visual-migration-release-plan.md)D2。当前通过虚构样本和本地事务适配器测试，尚未进行真实数据库试迁。工具不自动合并两个来源，也不修改旧库或开放正式入口。

## 1. 来源与映射

`convert.mjs`分别处理Supabase Planner五类记录与CloudBase Seating v1结构。每个目标ID由来源系统、来源项目、实体类型和旧ID的SHA-256生成；批次变化不改变业务ID，同名/同电话不合并。每条源记录有映射，缺失/重复ID标为unresolved并阻止试迁；不覆盖第一条记录。普通报告只有数量、哈希和问题代码，完整转换产物含原文，必须受限保存。

Planner保留姓名原文、电话字符串、备注、分组、桌坐标/旋转/容量、seatIndex、房号、个人晚次、笔记完整正文和时间。`confirmed`映射confirmed，`assigned/unassigned`映射pending，不根据排座推断出席；side默认unset，有房间时stayNeed为needed，无房间为pending。数值电话不会自动转字符串，非法内容阻止试迁。日期去重排序，重复及非法日期仍由来源盘点阻止；不创造新晚次。

本地补充配置需包含相同sourceProjectId，可提供title/mainStagePos/customGroups；stayDates与云端不一致时阻止试迁，保留两者。没有补充配置时标题/舞台使用显式默认值，报告标注缺口，不能据此声称已收集所有浏览器配置或已完成用户核对。完整源JSON和补充配置保留在provenance，未知字段、原时间和旧附件引用可追溯；图片不上传，纯图片且无正文的笔记仍须裁决，不静默丢弃。

Seating保留其独立side/attendance与世界坐标；无住宿信息时不发明房间或晚次。舞台语义与Fusion不同，必须提供绑定sourceProjectId和sourceHash的layoutDecision，含decisionId、confirmedBy、confirmedAt、coordinateMode=preserve-seating-world及明确mainStagePos（可为null）。这份人工裁决文件只记录决定，不能由工具证明签署者身份。原canvas/entrance/venue等仍在provenance；其他布局变换尚未实现。

## 2. 默认离线命令

所有输入/输出位于负责人确认的受控目录，拒绝Git工作树路径及其符号链接。完整产物含个人资料；使用加密备份工具保管原始资料，明文产物只用于受控操作。输出600权限、wx独占写入，不覆盖已有文件。

```sh
node --experimental-strip-types scripts/migration/convert-cli.mjs --input /CONTROLLED/source.json --source-system supabase-planner --project-id SOURCE_PROJECT --batch-id TRIAL_BATCH --config-file /CONTROLLED/browser-config.json --output /CONTROLLED/candidate.json
node --experimental-strip-types scripts/migration/reconcile-cli.mjs --input /CONTROLLED/candidate.json
node --experimental-strip-types scripts/migration/reconcile-cli.mjs --input /CONTROLLED/candidate.json --readback /CONTROLLED/readback.json --output /CONTROLLED/report.json
node --experimental-strip-types scripts/migration/batch-cli.mjs --input /CONTROLLED/candidate.json
```

Seating使用source-system=cloudbase-wedding，config-file提供layoutDecision。convert默认不写产物；reconcile默认不写报告；两者有阻塞问题退出2，输入/操作错误退出1。批次CLI默认dry-run，不获取云凭证。

对账独立按来源记录核验映射与每个目标字段，检查排序、额外/缺失记录、关联合法性、逐晚人数/用房数、完整正文、坐标及配置，同时核验源/补充配置/候选哈希。`readback`必须是完整`{data,notes}`，只给统计不能通过。100%处置覆盖是必要条件，不替代实际使用者对原安排的确认。

## 3. 隔离批次与显式写入

批次保留prepared/importing/failed/verified/published状态。绑定环境、目标项目、来源/配置/目标哈希、批次及双链接摘要；不同绑定拒绝复用目标。每个core/笔记单元分别提交，记录已完成单元；恢复先核对已提交内容，重复运行不新增单元。目标已有人改动、缺失已提交单元或已有项目入口时拒绝覆盖。失败标记只写脱敏代码，不写源内容。

verify读取完整core及所有笔记进行独立对账。publish再次核对全部内容，只有verified批次可原子安装current、笔记索引及access；未完成目标没有access，浏览器不可读。目标项目ID必须使用业务入口支持的fusion-created/fusion-migrated UUID。试迁已改为逐单元小事务与完整分批回读，不再有40条笔记上限。每次事务重新核对批次绑定和权限根；prepare保留关闭目标，import前全量检查已有单元，verify/publish逐项完整对账，最终事务原子安装current/笔记索引/access。目标数据库须保持普通客户端直接拒绝，操作者必须在prepare至publish期间排除其他管理员直接写入；跨事务回读不提供对并发管理员写入的原子快照保证，不能在有人直接改库时开放目标。published只表示**试迁副本完成受控开放**，不表示正式发布。已发布副本发生修改后禁止重新覆盖；如需恢复，使用已认证解密的原始备份、重新转换，在全新目标项目和批次重建。

`cloudbase-batch-store.mjs`按现有网关文档键与payload结构实现，事务内串行操作；数据库SDK的实际envName必须与指定目标相同，目标环境必须与源环境分离。集合名称必须显式填写。生产网关当前仍为探针集合实现，独立预发的集合/函数配置和资源限额必须实际验证后才能使用，不能把适配器模拟测试当作云端通过。

真实操作前按[执行单](2026-10-08-backup-migration-execution-sheet.md)完成确认。私有target-config文件包含environmentId、sourceEnvironmentId、projectId、isolated=true、collections.access/current及access.managementHash/collaborationHash。两个摘要必须是不同的64位十六进制SHA-256，秘密链接另外私下保管，不写入Git或普通报告。调用示例是操作模板，尚未执行：

```sh
node --experimental-strip-types scripts/migration/batch-cli.mjs --input /CONTROLLED/candidate.json --action prepare --apply --target-config /CONTROLLED/target.json
# 在同一目标依次执行import、verify、publish；默认不自动连续发布。
```

来源读取适配器与加密落盘CLI已实现，见[备份说明](offline-backup.md)。真实来源导出、受控备份落盘、云端限额及事务验证、权限拒绝、用户布局/住宿确认、预发网址与试用者、正式停写/切换与灾难恢复策略仍为待办。每日业务快照和图片上传继续延期。

## 缺失Planner云端配置的显式试迁补充

仅在来源project_config为空时，localConfig可显式提供sourceProjectId、原始rawJson的sourceHash及missingCloudConfig=guest-date-union。转换从个人stay_dates集合生成项目日期，仍验证非法日期、引用和全部领域约束；没有此决定仍阻止试迁。原始空配置、来源摘要和决定均保留，默认标题/空舞台与配置缺口记录，不称原浏览器配置已收集。对账独立重新推导日期及核验决定绑定。当前真实执行结果见[Supabase试迁](../validation/supabase-trial-migration-20261008/README.md)。
