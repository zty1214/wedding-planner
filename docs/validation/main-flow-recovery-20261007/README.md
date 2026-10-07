# 编辑交接与永久放弃补充验收

2026-10-07，业务基线 `f175d82a8920a754e617ce93009ed95fc14ae0e9`，本轮仅改测试夹具/驱动与证据文档，无业务src/server修改。实际App、IndexedDB、Chromium149.0.7827.55、Playwright1.62.1，127.0.0.1:4194，MemoryStore/probeGateway虚构网关。09:00:51–09:00:57 UTC七组通过，退出0，[原始报告](edit-recovery-report.json)。

| 用例 | 原operationId | 实际核对 |
| --- | --- | --- |
| 宾客编辑交接保存失败 | 607c1de4-9d08-4f6f-b3a2-4c042e3046a9 | 已落盘姓名/00123456789；仅冻结完整请求时注入save失败；队列0、回执不增、服务原值不变；刷新手动恢复输入及原ID |
| 宾客编辑清理失败 | 同上 | 恢复交接存储、注入remove失败；服务编辑成功且只增加1回执，表单冻结绑定原ID；刷新重复核对仍不增加回执；恢复清理、原请求核对后表单0、实体仍1 |
| 笔记编辑交接保存失败 | 29b71054-aa3c-4cf2-8cc4-2620fd798ba3 | 完整修改正文已落盘；冻结时save失败未写共享正文，回执不增；刷新后正文及原ID取回 |
| 笔记编辑清理失败 | 同上 | 服务更新正文，增加1回执，保留原冻结表单；刷新重复核对没有新回执，清理恢复后表单0、笔记仍1 |
| 未知结果拒绝放弃 | 8c97476c-b112-4c53-9efe-d28f69ade073 | 离线编辑未送达，刷新后仅恢复网络不批准发送；实际永久放弃确认被拒，原ID及队列保留 |
| 已知冲突永久放弃 | 同上 | 另一隔离上下文确认新值，原队列恢复后CONFLICT；实际点击整组放弃确认，队列0；刷新不重发、另一端值不变、回执不增 |
| 已成功但丢响应时放弃 | 8e4abc32-3323-4dab-820f-eb3f564456cc | 宾客修改已提交后丢响应；刷新在草稿面板永久放弃，核对原回执后提示0未提交/1已成功，只清本机记录；刷新队列0、云端值仍在、回执不增 |

截图：[宾客](guest-edit-recovered.png)、[笔记](note-edit-recovered.png)、[冲突放弃](conflict-permanent-discard.png)、[成功放弃重开](committed-discard-reopened.png)。这些是受控save/remove/HTTP丢响应注入，不能替代原生配额、进程SIGKILL或移动端切后台。未改用户浏览器数据。

## 真实云端创建与轮换丢响应

同一业务基线、实际App/SDK/IndexedDB，4197，指定开发探针；只新建虚构项目，不修改部署、权限或限流。环境与manifest SHA范围沿用[B01](../main-flow-b01-collaboration.md)，未独立复算部署代码。

[云端尝试B](attempts/cloud-links-b.json)的creation-success-lost-response已完整通过：项目 `fusion-created-310f97ab-1e5d-4353-bd62-449e8460d3b3`；服务project.create成功后仅客户端丢弃一次响应。本机原请求confirmed=false，原管理凭证可实际读到已存在项目；刷新后仍只有同一请求，新建按钮禁用，点击重试并确认后confirmed=true、同一项目/代次/原两份秘密不变；实际复制的管理/协作链接匹配原请求，比较只在测试进程内存中完成，不落凭证。[创建恢复截图](cloud-creation-recovered.png)。

轮换尝试A/B未完整通过：B已执行原候选、客户端丢响应、服务访问revision=1、原回执；刷新原候选一致，核对并复制原候选成功、访问revision及原回执不变。最终旧会话提示断言发生strict locator violation（同文案多处匹配），脚本已限定header状态；未通过终点因此不关完整云端UI轮换用例。[尝试C](attempts/cloud-links-c.json)重验时实际提示今日开发环境创建额度已用完，[截图](cloud-create-rate-limited.png)，未绕过/修改额度，未继续重试。云端创建完整通过可以独立关单，云端轮换丢响应的最终新链接进入仍保持待验；正常轮换旧链接读写拒绝已由B01通过，不与此混写。

历史local尝试A因驱动误读read响应value结构而TypeError，B因导航“笔记”与实际“备婚笔记”不符超时；C修正后七组通过。所有历史脱敏JSON保留attempts；未冻结每次中间驱动版本，不声称逐字重现历史脚本。无确定业务缺陷。

## 命令和验证

```sh
# 4194必须空闲，报告目录必须全新；该脚本自行启动/停止所拥有的夹具
node scripts/fusion/main-flow-edit-recovery.mjs /private/tmp/new-edit-recovery-evidence
# 4197必须空闲，只在开发创建额度可用时执行；公开SDK配置沿用已有路径
node scripts/fusion/main-flow-cloud-link-recovery.mjs /absolute/path/to/existing-config.env docs/validation/2026-10-05-access-deployment.json /private/tmp/new-link-recovery-evidence
```

可用PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH指定已安装浏览器。当前云端驱动已识别额度提示为blocked/退出2，此分类改动只做语法/lint检查，未再次消耗额度验证；原C报告保留当时timeout失败，不追改历史。

相关46项formHandoff/repository回归通过、lint无警告、四脚本node --check及git diff --check通过。上阶段191项全量check仍为最近完整结果，未因测试工具/文档变更重复声称全量重跑。
