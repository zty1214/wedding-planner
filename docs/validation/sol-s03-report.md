# S03 四模块本地浏览器验收夹具

2026-10-07。基线为本工作树S02交付725bc1f7b71bde74e345929792d1a4eb2a3b0a7f（其业务基线207a267）。只新增本脚本与本报告，业务src/测试/package/CI均未修改。

## 启动和隔离

仓库根目录执行 `node --experimental-strip-types scripts/fusion/sol-s03-main-flow.mjs`，独立浏览器标签访问 http://127.0.0.1:4192/fusion 。

Vite configFile:false、envDir:false；已有React及Tailwind插件，cacheDir位于/private/tmp，strictPort绑定127.0.0.1:4192。仅此脚本的pre-load插件覆盖src/fusion/cloudClient.ts，将connectGateway替换为同源本机fetch。未加载CloudBase SDK、.env或凭证；真正App路由、创建页、FusionLayout及四模块沿用原代码。

本机JSON网关使用MemoryStore及probeGateway。项目/回执/笔记等内存状态在页面刷新后保留，进程停止后清空；浏览器IndexedDB由业务代码真实运行。重启服务器后旧IndexedDB创建记录仍会存在、对应内存项目已不存在；请创建新的虚构项目，不把旧条目的读取失败当云端故障。测试中的随机本地链接秘密不是云凭证；服务不记录请求、链接、秘密或原始异常。

POST输入上限1 MiB；过大返回413/REQUEST_TOO_LARGE，非法JSON返回400/INVALID_INPUT，非POST返回405/INVALID_INPUT；有效JSON由现有gateway判断。未提供故障开关。

## 已实际验证

- 服务实际启动成功。HTTP获取/src/fusion/cloudClient.ts确认返回本机fetch覆盖代码，且不含@cloudbase、VITE_FUSION或cloudbase.init。
- GET网关405/INVALID_INPUT，POST非法JSON400/INVALID_INPUT，POST空对象200/FORBIDDEN，POST超过1 MiB返回413/REQUEST_TOO_LARGE，均实测并用Node assert核对。
- HTTP创建随机本地虚构项目“S03 HTTP虚构项目”，管理读回标题与management角色正确；重复同一创建请求返回同一项目，幂等断言通过。秘密只在脚本内生成，不写报告或日志。
- `node --check scripts/fusion/sol-s03-main-flow.mjs` 通过。

## 待主会话真实UI验收

子agent CUA连接无可用浏览器（listBrowsers返回空列表），未操作其他标签。按主会话指示，以下均标为待验，不能用HTTP成功替代UI流程：

1. 在/fusion输入新项目名“S03四模块虚构验收”，点击“新建独立项目”，再点“打开项目”。
2. 名单页新增“跨年虚构宾客 001”，电话“00123456789”；保存并读回。
3. 座位页新建“虚构桌 01”，分配该宾客到座位；保存并读回。
4. 住宿页新建“001”标间，设置2026-12-31、2027-01-01两晚及该宾客入住；保存并读回。
5. 笔记页新建“跨年安排”，正文“仅本地虚构验收”；保存后刷新页面，依次检查宾客电话前导零、座位、房号与跨年晚次、笔记正文。

以上是拟执行值，尚无浏览器执行证据。确切控件名称由真实UI状态确认；本报告不声称四模块主流程通过、真实云端通过或CI自动E2E。

## 后续自动化接入建议

保留本夹具作为显式本地验收入口。后续可由独立浏览器自动化任务按真实控件驱动上述流程，并将实际下载、截图、刷新读回断言归档；需要先确定项目数据清理与IndexedDB隔离策略。当前未添加依赖、npm命令或CI配置，未推送/部署。
