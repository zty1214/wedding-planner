# 混合命令整组留存验收

2026-10-07，业务基线b6dc15e；实际App＋独立Chromium151＋真实IndexedDB＋本机MemoryStore/probeGateway，仅虚构项目、无云端连接。

命令：`node scripts/fusion/main-flow-edit-recovery.mjs <新的证据目录>`。端口4194占用时退出，不接管其他服务；新目录防止覆盖既有报告，浏览器/夹具均由脚本创建和关闭。

[八组通过报告](edit-recovery-report.json)：原七组仍通过；新增宾客电话编辑→笔记正文编辑的两条离线队列。重开后先由独立上下文修改共享宾客，明确继续同步产生首条冲突；后续笔记未发送、共享正文保持先前确认值。实际按钮将两条原请求整组留存并退出队列，刷新后展开留存并真实下载[原草稿JSON](retained-mixed-batch.json)，逐条完整比较命令、状态、sequence、原ID/epoch/版本条件和内容。留存/下载回执增加0，重新编辑宾客增加1，原笔记未重发。见[实际截图](mixed-conflict-retained.png)。

初次观测误用IndexedDB getAll主键顺序，导致类型顺序断言失败；修正为实际队列sequence顺序后通过，失败报告保留在attempts。未修改业务源码。

本证据补齐单条桌名以外的编辑类、多类型整组留存代表路径，不宣称任意命令排列均已验收；真实云端轮换丢响应终点、原生配额、真机和失败CI仍未关闭。

## 四模块混合队列完整投影

新增 `tests/fusion/recoveredExport.test.ts` 用例：宾客姓名/前导零电话、桌名/坐标、房号、跨年晚次、连续两次笔记正文修改共七条请求。真实repository＋持久outbox（fake-indexeddb）＋鉴权probeGateway/MemoryStore：重开要求明确批准；导出保持原队列与共享确认状态不变、回执增加0；明确恢复后四模块数据与投影一致、队列清空，七个原ID各有回执。笔记updatedAt由投影和提交分别生成，仅此时间字段不作值相等断言；正文、revision、createdAt及notesRevision均比较。此为本地集成证据，不替代浏览器/云端层。

[本阶段完整检查](integration-check.txt)退出0：192项测试，150人/90版本规模、Fusion类型、lint、默认及虚构Fusion构建通过。业务基线b6dc15e加本阶段未提交测试/文档；src/server业务源码没有变化。
