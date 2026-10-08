# 离线加密备份与恢复工具

工具为 `scripts/migration/backup.mjs` 和 `backup-cli.mjs`。不连接云端，不修改数据库，不代替正式迁移或灾难恢复演练。

`collectBackupSource(metadata, collections, readPage)` 要求调用方使用明确项目、稳定顺序和精确count的读取器，逐页记录offset、长度、count和页内容SHA-256；发现数量变化、空缺页或重复/缺失ID立即拒绝。来源结构和旧附件引用原样保留。默认标为preliminary；冻结状态须有外部停写证据哈希，工具不自行证明旧端停写或跨集合的一致时间点。来源只读适配器与加密落盘CLI已接入工具链，当前只使用虚构样本及本机HTTP来源验证，未执行真实备份。

来源manifest包含sourceSystem、sourceProjectId、schema、exportedAt、consistency和collections分页证明。当前支持supabase-planner、cloudbase-wedding、browser-local、fusion-project来源名称；名称不表示已实现四类读取或完整数据库恢复。各collection原始JSON数组中的记录ID使用_id/id/project_id核验。

加密使用随机32字节独立密钥、AES-256-GCM和每次随机12字节IV；源manifest、原始JSON文本和SHA-256全部位于认证加密载荷内。校验时先认证、再核对分页和源哈希；恢复文本逐字保留输入JSON的空格、换行与记录内容。普通输出只有状态、数量和哈希，不含名单、电话、项目ID或密钥。

## 使用方式

以下路径是待负责人确认的受控目录占位符。目录先由负责人建立；不要使用仓库、普通共享目录或把密钥与备份一起分发。CLI拒绝Git工作树中的读写路径，包括指向Git内部的符号链接；密钥须600权限，所有输出用600权限和wx独占写入，不覆盖已有文件。

```sh
node scripts/migration/backup-cli.mjs --mode keygen --key-file /CONTROLLED_KEYS/backup-key
node scripts/migration/backup-cli.mjs --mode seal --input /CONTROLLED_EXPORT/source.json --metadata /CONTROLLED_EXPORT/manifest.json --key-file /CONTROLLED_KEYS/backup-key --output /CONTROLLED_BACKUPS/source.encrypted.json
node scripts/migration/backup-cli.mjs --input /CONTROLLED_BACKUPS/source.encrypted.json --key-file /CONTROLLED_KEYS/backup-key
node scripts/migration/backup-cli.mjs --mode restore --input /CONTROLLED_BACKUPS/source.encrypted.json --key-file /CONTROLLED_KEYS/backup-key --output /CONTROLLED_RECOVERY/source.json
```

不指定mode时仅verify，不写解密文件；restore只产生离线原始文件，不执行云端导入。真实备份前按[执行单](2026-10-08-backup-migration-execution-sheet.md)确认来源、位置和责任人。离线稳定ID转换、独立对账与批次续做/拒绝覆盖工具见[迁移说明](offline-migration.md)。还需完成实际来源适配器、冲突裁决、隔离云端全量回读与恢复演练。

验证见[阶段记录](../validation/offline-backup-20261008/README.md)。

## 明确来源的只读加密导出

`source-readers.mjs`对Planner每页使用project_id过滤、稳定排序和精确count，回读再次核验归属；CloudBase只读weddings中同时匹配_id/projectId的单一文档，核验schemaVersion与内外updatedAt，保留完整包装、未知字段及原引用。记录数量变化会拒绝；内容在相同数量下持续变化仍不能靠分页证明一致，所以CLI只标为preliminary。最终冻结需另有停写证据。

`source-backup-cli.mjs`默认只检查配置，不访问网络；`--read-source`明确执行只读导出。Planner私有source-config包含url/anonKey；CloudBase包含environmentId/region（上海），管理员临时凭证仅内存复用。配置、来源项目、密钥和输出须显式指定；密钥600，输出已存在时在读取来源前拒绝。加密写盘后再次认证并核验源哈希，标准输出只含数量/哈希；不写明文原始数据或单独manifest。

```sh
node --experimental-strip-types scripts/migration/source-backup-cli.mjs --source-system supabase-planner --project-id SOURCE_PROJECT --source-config /CONTROLLED/source-config.json
# 真实来源范围及备份位置确认后才加下列参数：
# --read-source --key-file /CONTROLLED_KEYS/key --output /CONTROLLED_BACKUPS/source.encrypted.json
```

CloudBase完整包装备份解密后可直接输入Seating转换，sourceHash贯穿备份、布局裁决、转换和对账；不会为转换剥掉项目归属/时间信息。此功能尚未证明实际账号的读取权限、真实来源的归属或目标云端恢复。

新Fusion项目级完整备份与隔离数据库恢复、平台回档及保管频率最小方案见[灾难备份恢复](disaster-backup-recovery.md)。已补齐离线/SDK边界能力，真实目标恢复仍待执行。


## 环境备份文档ID边界

当前工具支持非空字符串文档ID，包括业务记录及存储对象的字符串标识。普通字段中的BSON日期等仍以规范EJSON保留，但这不表示支持任意BSON类型的文档ID。遇到ObjectId、数值等非字符串ID，读取阶段明确返回 `UNSUPPORTED_SOURCE_ID_TYPE`，不得把失败或部分内容称作完整备份。已补虚构ObjectId/数值ID拒绝回归。若后续真实来源出现此类ID，先明确键排序、去重及恢复的兼容规则后增加支持，不静默转字符串，也不在本轮扩展恢复模型。
