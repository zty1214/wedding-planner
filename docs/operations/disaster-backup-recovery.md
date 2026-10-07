# 独立灾难备份与恢复最小方案（待实环境演练）

2026-10-08。独立加密备份、恢复控制与默认dry-run CLI已实现，本地虚构/SDK传输替换通过；未执行真实备份、云端恢复、定时任务或正式切换。

## 1. 最小保管方案

此处与已延期的每日产品业务快照分开。CloudBase[官方回档说明](https://docs.cloudbase.net/database/backup)称文档库每日北京时间02:00–06:00系统备份、默认保留7天，回档生成新集合；这些是平台能力说明，当前账号/目标环境实际可用时间点和套餐权限尚未验证，不当作当前成功备份。

建议：平台每日备份作为近期回档来源；再保留项目级独立加密备份，迁移前/正式切换前/批量危险操作前各一次，试用期每周人工一次。暂不新增应用每日快照或自建定时系统。独立材料保留最近四周、切换前最终一份及观察期结束后一份，旧源原始备份另按用户确认期限保管；不自动删除。

建议恢复点目标不超过24小时、恢复时间先按4小时作为待演练目标；这不是已经达到的承诺。备份位置、读取者、密钥分离保管、检查责任人与失败通知方式仍由负责人确认。检查平台最近可回档时间是否过期及独立文件认证是否通过；检查失败联系负责人并保留现状。未创建提醒、邮件、通知自动化，也没有把待确认频率当成已运行任务。

## 2. 项目级独立材料

`collectFusionBackup`使用SDK实际envName、明确项目及四个显式物理集合，精确count和100条封顶分页；回读每行projectId，保留全部_id/projectId/payload及未知字段。包含access权限摘要、current各代次/笔记/索引/历史/回收状态、receipts及activity。项目过滤不会导出别人的项目；环境全局创建额度、云端配置、安全规则和部署包不属于此项目数据文件，另由配置/版本执行单保管。

来源环境、物理集合映射、项目、schema、时间、分页和哈希均在认证加密载荷内。双链接明文秘密不由摘要反推，原秘密仍需私下保管；恢复工具保留原权限摘要，不创造管理权或替换密码。CLI source-system=fusion-project，source-config含environmentId/region/四集合，其他参数与[备份说明](offline-backup.md)一致。默认不联网，显式read-source才读取，输出仅加密文件。

持续写入下的独立采集为preliminary；恢复演练可以用副本，正式恢复/切换必须核对一致来源与实际停写或平台一致时间点。文件认证通过不证明导出时没有并发业务写入。

## 3. 空白隔离恢复

`fusion-recovery.mjs`从加密文件认证和分页校验开始，校验项目归属、原权限摘要、current core及当前笔记索引引用；适用正式Fusion业务项目UUID，保持项目ID、dataEpoch、revision、正文、时间、回执及所有未知字段。目标环境必须与加密manifest的实际来源环境不同，项目仍使用原ID，因此回执和权限绑定保持原值。

prepared/importing/failed/verified/published批次绑定目标环境/集合、来源哈希和批次。导入逐文档事务，已写内容不同则拒绝，中断可核对续做；prepare要求项目范围为空。verify扫描全部四类目标，并排除唯一内部恢复控制记录，按ID和全部JSON字段与源文档核对。publish再次全量回读后，原子安装current和access两根记录；未完成时没有访问入口。目标在导入/核对期间保持关闭，管理员不能并发直接改集合；所有支持的恢复写入都通过同一批次。正常浏览器无法修改未开放项目，已开放项目的人工编辑会使再次导入/发布拒绝，不回写源库。

[平台事务限制](https://docs.cloudbase.net/database/transaction)为100操作/30秒且仅doc，恢复扫描位于事务外，写入逐文档，最终根记录原子提交。本地209文档演练每次事务不足20操作；这不是目标云端时延证明。Supabase/Seating试迁工具同样改为有界单元事务与分批完整对账，取消旧40条笔记限制；200条笔记完整回读测试每事务不足20操作，仍须在关闭且排除其他管理员直写的隔离目标执行。不声称本地规模测试已证明云端时延或所有数据库文档大小边界。

```sh
node --experimental-strip-types scripts/migration/fusion-recovery-cli.mjs --input /CONTROLLED_BACKUPS/fusion.encrypted.json --key-file /CONTROLLED_KEYS/key
# 确认来源、空白隔离环境和恢复范围后，显式--action prepare --apply --target-config /CONTROLLED/target.json
# 同一绑定依次import、verify、publish；不自动一次性开放。
```

target-config包含environmentId/sourceEnvironmentId、isolated=true、batchId及四个collections。来源env必须匹配认证manifest；目标SDK实际env也须匹配。默认仅计划、不获取云凭证；认证或引用失败先拒绝。只输出状态/数量/哈希，不输出ACL、项目ID、姓名、电话或正文。

## 4. 正式恢复前门槛

实际受控备份保管确认→隔离目标恢复→同项目ID及全量文档回读→正常网关两种链接/历史/回收/导出抽查→计时和权限验证→用户确认。回档新集合的直接客户端规则、后台角色权限与业务函数配置须重新核对，不把“新集合生成”当作业务入口已经切换。前端回退与数据恢复分开；恢复以后再有业务修改不能用旧备份覆盖，须先保留现状和确认具体恢复窗口。
