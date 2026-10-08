# Supabase真实备份与CloudBase试迁

2026-10-08。用户明确授权读取Supabase线上数据、本地备份并迁入CloudBase，要求Git忽略真实数据。五表完整分页发现4个来源项目，共135位宾客、15张桌、14个房间，笔记及project_config均0条，总164条。

## 实际结果

全部4项目已分别迁入全新CloudBase业务项目，保留旧数据和Supabase来源。主要项目为134位宾客、12桌、14房；其余三个来源只有1位宾客、1桌、2桌，保留为独立副本，不并入主要婚礼。

每来源两次完整分页读取一致；AES-256-GCM原样加密、磁盘解密校验、密钥分离。备份和明文操作产物位于用户本机Backups/wedding-planner/supabase-trial-20261008，文件600/目录700、Git仓库外。仓库.gitignore新增.private-data/private-data/backups/*.json.enc/*.backup.key并实际check-ignore验证；真实数据、源配置、访问链接、密钥与网页截图均未纳入Git。本目录只包含聚合数量、摘要与检查状态。

prepare/import/verify/publish/再次verify全部通过；160+1+1+2条来源记录100%稳定映射、完整字段/关联/逐晚对账。见[迁移报告](migration-report.json)。真实业务网关两类链接读取4项目并再次完整字段对账；主项目真实浏览器134人、刷新和零Supabase请求通过，见[网关/网页](gateway-browser-verification.json)。未截图真实名单。

## 配置缺口与适用范围

线上缺project_config，23位宾客已有个人住宿日期。迁移按明确记录的guest-date-union补充策略，从现有宾客日期集合生成项目日期，默认标题、空舞台位置；决定绑定来源项目及原始哈希，不修改原始空配置，也不创造个人住宿日期。工具默认仍阻止缺配置，只有显式绑定补充配置才能试迁；来源错误/非法日期及对账缺字段仍拒绝。用户尚未提供原浏览器配置，标题/舞台/额外日期与实际布局需核对。

来源未停写，备份为preliminary；当前是试迁副本，后续Supabase变化未自动同步，未正式停写/切换。其他CloudBase wedding来源不在本次Supabase迁移中自动合并。管理员保留清理仍未执行；本次迁移授权不绕过之前清理审批拒绝。

本阶段完整检查244项通过；实际云端运行代码仍为先前c0a7f1a，修改仅操作工具，无需重新部署网页/业务函数。
