# 离线加密备份与恢复工具

工具为 `scripts/migration/backup.mjs` 和 `backup-cli.mjs`。不连接云端，不修改数据库，不代替正式迁移或灾难恢复演练。

`collectBackupSource(metadata, collections, readPage)` 要求调用方使用明确项目、稳定顺序和精确count的读取器，逐页记录offset、长度、count和页内容SHA-256；发现数量变化、空缺页或重复/缺失ID立即拒绝。来源结构和旧附件引用原样保留。默认标为preliminary；冻结状态须有外部停写证据哈希，工具不自行证明旧端停写或跨集合的一致时间点。真实读取适配器尚未接入，当前只使用虚构样本。

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

不指定mode时仅verify，不写解密文件；restore只产生离线原始文件，不执行云端导入。真实备份前按[执行单](2026-10-08-backup-migration-execution-sheet.md)确认来源、位置和责任人。还需完成来源适配器、稳定ID转换、冲突裁决、批次续做/拒绝覆盖以及隔离目标全量回读与恢复演练。

验证见[阶段记录](../validation/offline-backup-20261008/README.md)。
