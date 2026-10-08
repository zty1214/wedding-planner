# 用户反馈迭代：dev部署与云端验收

已部署源码：`ab95ed38f3c50016c84cf940d4579053fa403685`。试用网址：[CloudBase新版](https://dev-d1gh3jw1gdf06af22-1456231968.tcloudbaseapp.com/)。同提交[CI #37792750758](https://github.com/zty1214/wedding-planner/actions/runs/37792750758)全部成功，见[步骤回读](remote-ci.json)。后续验收工具/文档提交不冒充运行版本。

## 更新与回退材料

沿用用户既有继续CloudBase部署授权。只更新业务网关`planner-fusion-gateway`及Fusion-only静态网页；原业务集合、项目权限、运行配置和每日200额度保留，未部署清理/每日任务，未重导入或直接改写真实婚礼项目。retention代码保持原版本。

部署前只读备份10集合1715文档、4云存储文件2718字节及4函数配置，AES-256-GCM加密重开校验、两次摘要一致。数据保存在`/Users/baojie/.local/share/wedding-planner-backups/2026-10-08-ab95ed3/`，密钥在单独的`/Users/baojie/.local/share/wedding-planner-backup-keys/`；Git只保存[统计摘要](backup-verification.json)。一致性为preliminary，未冻结全环境写入，不能称环境镜像。

另下载旧业务网关/retention代码并备份旧首页实际引用资源及build-info，旧网页提交`c0a7f1a`，为本次回退材料。全环境备份仍不包括鉴权用户/索引；网页副本限定实际引用资源，不能声称全部Hosting对象已离线备份。发布保留CloudBase safe备份且不prune。

## 实际回读

[网关回读](gateway-readback.json)：Active，Nodejs20.19/256MB/20秒/index.main，8项既有变量及日志开关一致，下载活跃代码SHA256 `f4080bc4d651ce22d09037396ffffbc61ae049d30854cddc58147a81fe77d489`与SDK3.18.3内联候选包一致。

[Hosting回读](hosting-readback.json)：7个公开文件逐个HTTP下载与本地产物SHA256相同；build-info明确源码ab95ed3、网关及代码哈希。safe和verify启用，未prune。首次以`/`为cloudPath触发CLI3.8.5根路径归一化缺陷：上传去前导斜杠，清单/备份/校验保留，7文件均报missing；CLI称自动回滚，但真实build-info回读404。保留[首次失败](hosting-first-attempt.json)，改用省略cloudPath的空根路径完成发布，不去掉校验。上线不能仅以CLI回滚/上传提示判断成功。

## 云端验证范围

- [真实网页7项](browser-report.json)：正常创建虚构项目、电话前导零与刷新深链、默认待确认宾客在新房弹窗可搜索/安排、房间统一晚次与按晚1间/1人、笔记刷新、实际下载云端确认住宿文件与页面统计一致、独立390px浏览器读回。Supabase请求0；390px是桌面模拟。
- [两个独立匿名身份6项](independent-clients.json)：不同uid仅内存核验；共享读写、错误凭证拒绝、并发编辑单赢家、房间整批安排单赢家与冲突零批次写入、两人统一住两晚及原回执重放不覆盖当前安排、轮换撤权、整项目恢复/安全版本/旧代次拒绝。只修改新建虚构项目。
- [直接客户端权限](client-permissions.json)：四个业务集合实际ADMINONLY，20种直接访问均DATABASE_PERMISSION_DENIED。

[证据绑定](evidence-binding.json)记录实际验收脚本hash。脚本增强后先用本地内存网关演练7项，再验真实网页；仅验收工具改变，不更改已部署源码。未执行Excel/WPS应用验收，也未将其设为发布前置条件。

## 尚未完成

iPhone微信/Safari与Android真机触摸、软键盘、侧滑、切后台、安全区、文件保存和用户整体视觉验收仍待反馈；桌面模拟及合成触摸不能替代。已请使用者从上述入口创建临时项目核对。此结果证明dev候选部署及限定云端验收，不代表正式切换main/GitHub Pages、旧站退役或观察期验收结束。
