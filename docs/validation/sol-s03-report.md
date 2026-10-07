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

## 主会话真实 UI 验收通过

2026-10-07，主分支集成夹具 `dc0776d` 及配置修正 `778cacb` 后，由真实浏览器页面完成以下操作。项目为 `fusion-created-f7aaa886-4362-408a-a098-3c1013b43e19`，标题“S03修复后四模块验收”。

1. 从创建页创建独立虚构项目，再打开项目。
2. 新增“跨年虚构宾客 001”，电话“00123456789”，设置需要住宿。
3. 新建10人桌并改名“虚构桌 01”，为该宾客分配座位。
4. 新建标间“001”，分配该宾客，选择2026-12-31、2027-01-01个人住宿晚次。未确认住宿需求时宾客不会出现在分房候选中，确认需求后正常可选。
5. 发布酒店分类笔记“跨年安排”，正文“仅本地虚构验收”。
6. 整页刷新后，笔记标题/正文仍在；名单中电话前导零、桌名、房号、需要住宿状态正确；住宿两晚按钮均为pressed，待分房/需求待确认/晚次待定均为0，单晚最多1人；排座选择器显示“虚构桌 01 · 1/10 人”。

验收中另添加了未使用的2026-12-30日期，未为宾客勾选，保留现场；最终两晚以DOM完整日期和pressed状态核对。截图：

- [名单刷新回读](sol-s03-guests-reloaded.png)
- [住宿刷新回读](sol-s03-stay-reloaded.png)
- [笔记刷新回读](sol-s03-notes-reloaded.png)
- [排座刷新回读](sol-s03-seating-reloaded.png)

这证明真实页面、业务表单、本机IndexedDB和本机网关的四模块流程可运行。页面沿用产品“已同步到云端”文案，此夹具下仅代表本机网关确认，不代表CloudBase访问；进程重启后的服务端持久化、独立浏览器身份、真机、自动CI仍未由本轮证明。

## 后续自动化接入建议

保留本夹具作为显式本地验收入口。后续可由独立浏览器自动化任务按真实控件驱动上述流程，并将实际下载、截图、刷新读回断言归档；需要先确定项目数据清理与IndexedDB隔离策略。当前未添加依赖、npm命令或CI配置，未推送/部署。

## UI接续发现及夹具修正

主会话真实UI已完成项目创建，但打开项目时FusionLayout独立检查env/key，最初夹具未提供导致“新数据入口尚未配置 CloudBase 环境”。这不是四模块通过的证据。夹具增量补充Vite define：VITE_FUSION_ENV_ID=sol-s03-local-fictitious-env、VITE_FUSION_PUBLISHABLE_KEY=sol-s03-local-fictitious-key，仅为绕过该入口配置检查的明确虚构占位；cloudClient仍被本机fetch覆盖，envDir:false保持，未加载真实.env或SDK。服务重启清空内存，主会话应新建虚构项目继续UI验收。

修正后重启实际HTTP验证通过：cloudClient编译内容仍为/__sol_s03_gateway本机fetch且无@cloudbase/cloudbase.init；FusionLayout编译内容同时包含上述两个虚构占位值。Node assert核对三项通过；当时UI仍待主会话接续，后续已通过，见上方2026-10-07真实浏览器验收段。
