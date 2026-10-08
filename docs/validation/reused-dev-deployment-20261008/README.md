# 复用dev部署与真实云端验收

2026-10-08。用户授权先备份dev后继续部署；不购买第二环境。实际部署源码候选为 `c0a7f1a879e863de763d0b0bd733e63f5c6c796c`，该候选的[同提交CI](https://github.com/zty1214/wedding-planner/actions/runs/37716976849)成功。本目录及浏览器工具的后续提交记录验收结果，不冒充云端包源码版本。

网页：[CloudBase试用入口](https://dev-d1gh3jw1gdf06af22-1456231968.tcloudbaseapp.com/)。首页为新项目入口；当前使用新建虚构项目，尚未迁入真实Supabase名单。

## 已执行与证据

- 新建四个planner_fusion_preprod_*集合，直接客户端权限ADMINONLY；业务网关与内部清理函数均Active。Nodejs20.19、256MB、20秒、200创建额度与日志禁用实际回读见[配置](configuration-readback.json)。
- 下载实际活跃函数代码，与部署包SHA256逐一一致，见[代码回读](active-code-readback.json)。SDK3.18.3内联入包，未使用云端自动安装。
- 新业务网关匿名鉴权允许；retention客户端deny；旧通配和probe规则保留。见[函数权限](function-permissions.json)、[四集合20种直接访问均拒绝](client-permissions.json)、[清理客户端拒绝](retention-denial.json)。
- 两个独立Node SDK匿名身份：共享读写、错误凭证拒绝、并发单赢家、链接轮换撤权、恢复代次拒绝旧请求均通过，见[独立客户端](independent-clients.json)。
- Fusion-only静态站点上传7/7、verify成功，safe备份旧静态文件、不prune；SPA回退及公开build-info实际回读，见[Hosting](hosting.json)。数据库与云文件[私有加密备份](../dev-environment-backup-20261008/README.md)保留；这些备份不构成整个环境镜像。
- 真实网页新建、宾客电话前导零、排座、住宿房号、笔记发布后刷新及独立390px浏览器共享读全部通过，见[浏览器报告](browser-report.json)与截图，零Supabase请求。390px模拟不能代替真机触摸、软键盘、切后台与文件保存。
- 完整检查243项通过；验收工具修改后的完整检查再次通过，lint与diff检查通过。

## 验收过程与限制

保留中间浏览器b/c/d失败报告。测试在字段交接完成前只等待旧“已同步到云端”文字便刷新，留下未确认命令，网页进入草稿待确认并暂停编辑。最终工具等待保存房号按钮退出及笔记编辑器交接完成，再等云端确认与刷新，通过全部六项；产品源码无需调整。

管理员实际调用retention被自动审批拒绝：可能删除到期数据，部署授权未明确包含执行清理。未绕过拒绝，未管理员执行、未启用清理定时器；仅客户端拒绝已验证。一次仅新业务集合清理验收另待明确授权。

旧weddings、probe集合/函数和存储文件未删除；GitHub Pages现有Supabase站点与main未发布。GitHub远端仅main与feat/planner-cloudbase-fusion，已删除验收分支历史全部包含于feat，未改写历史。

真实两来源项目/负责人、冲突裁决、试迁全量对账与隔离恢复、用户观感及真机验收仍待完成；正式冻结、最终备份、切换、回退和观察验收另按执行单。
