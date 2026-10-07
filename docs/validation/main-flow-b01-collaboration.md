# B01 真实云端双端主流程验收

2026-10-07，业务基线 `9514d31e14abc3e4382a1defcb683867d860c204`；本轮未修改业务 src/server。实际 App、Playwright 1.62.1、Chromium 149.0.7827.55，两个隔离存储上下文各自使用真实 CloudBase 匿名登录，在内存核对 UID 不同，仅记录布尔结果。服务绑定127.0.0.1:4197；全程使用新建虚构项目，通过产品复制/粘贴管理和协作链接接入，没有写入浏览器存储来替代链接交付。

开发环境 `dev-d1gh3jw1gdf06af22`，函数 `planner-fusion-gateway-probe`；CLI只读核对Active、LOG_EVENT_CONTEXT=false和原两项目白名单。部署清单声明SHA `2052a7b9707af47598741c2d1c5263700a93d936b558cde0cebe1a228ac19f12`；functionDetail未提供可复算代码正文/摘要，本轮未独立下载包复算，不能声称远端源码与本地完全一致。未部署、推送、迁移或变更云端权限，未操作来源婚礼项目。

[完整通过报告](main-flow-cloud-20261007/cloud-browser-report.json)退出0，08:45:21–08:46:21 UTC。主项目 `fusion-created-c4760324-7c3d-4fa3-a527-7fbff0397925`；隔离切换项目 `fusion-created-bd3f6dc4-b5ce-42e0-bacb-659ed921755b`。

| 路径 | 实际结果 | 证据范围 |
| --- | --- | --- |
| 创建、名单、排座 | 产品创建/复制加入；电话00123456789；实际Konva选桌并分配甲；云端回读及刷新一致 | 正常交互与真实SDK观测 |
| 同房不同晚 | 甲12/31+1/1、乙仅1/1；逐晚人数1/2、房数1/1，独立端及重开一致 | [住宿截图](main-flow-cloud-20261007/main-flow-e2e-stay.png) |
| 笔记与独立协作 | 原正文刷新可读；另一身份回读四模块，新增丙后管理端刷新可见 | 最终3宾客/1桌/1房/1笔记 |
| 同记录冲突 | 旧桌名请求冲突，不覆盖管理端确认值；归档退出队列不增加云端revision，刷新原意图仍在；实际下载核对原ID/意图，再编辑明确提交成功 | [原请求下载](main-flow-cloud-20261007/cloud-retained-conflict.json) |
| 权限与轮换 | 协作预览无整项目恢复入口、无链接管理入口；管理端准备/轮换/复制新链接；已打开旧会话拒绝，旧链接真实读与execute写均FORBIDDEN | 私有离线原草稿换链接/重开仍保留；已知拒绝意图归档后可正常操作 |
| 两云项目切换 | 第二项目四模块为空，不显示第一项目未提交标题；返回原管理链接，原私有标题可手动恢复 | 云端数据与本机表单隔离；未提交标题不写云端 |
| 同座竞争、关联删除/回收 | 复用[云端并发](2026-10-05-concurrency-cloud.json)、[回收关联](2026-10-04-recycle-cloud.json)及[主会话实际浏览器回收](2026-10-05-main-flow.md) | 历史证据范围不升级为本次重跑；不重复已经覆盖用例 |

另以同一个Chromium上下文的两标签验证真实云端共享队列：[通过报告](main-flow-cloud-20261007/cloud-shared-queue-report.json)、[截图](main-flow-cloud-20261007/cloud-shared-queue.png)。项目 `fusion-created-107e20d8-4395-46a8-b335-d63ea44a1ba1`，两页离线同一 operationId `5c458af6-81c4-4007-afb3-a8b280b4c915`，待确认1→0；重连后关闭第一页，再刷新第二页，服务端宾客1、原回执匹配，无重复新增。08:47:03–08:47:10 UTC，退出0，同一业务基线和浏览器；原报告未记录这两字段，执行环境在此补充，不改写历史JSON。独立身份与共享数据库证据分别成立。

复跑入口（仅受控虚构项目；需要已授权的现有公开SDK配置路径，不复制凭证）：

```sh
node scripts/fusion/main-flow-cloud-browser.mjs /absolute/path/to/existing-config.env docs/validation/2026-10-05-access-deployment.json /private/tmp/new-cloud-browser-evidence
node scripts/fusion/main-flow-cloud-shared-queue.mjs /absolute/path/to/existing-config.env docs/validation/2026-10-05-access-deployment.json /private/tmp/new-cloud-queue-evidence
```

4197必须空闲；两条命令顺序执行，报告目录必须全新。可用PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH指定已有匹配浏览器。SDK观测30秒、条件等待最长60秒，失败非零退出；不保存原始链接、UID、SDK异常、trace或HAR，链接管理面板截图遮盖。

第一项协作关闭条件已覆盖，T01关单。B01任务表附带的创建/轮换丢响应在本地真实UI及既有服务端回归有证据，云端创建UI丢响应已追加通过，云端轮换UI丢响应最终重验受开发额度阻塞，见B02追加，仍按B02剩余矩阵保留；不据此关闭全部T05/T07，也不证明真机触摸或运营网络表现。
