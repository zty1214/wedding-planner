# CloudBase 操作手册：登录复用、隔离验证与故障排查

适用范围：本仓库 CloudBase 文档数据库（NoSQL）开发验证。依据 2026-10-04 的实际执行、固定版本 SDK 和已保存报告整理；不是生产迁移或发布授权。后续先按本手册和现有脚本操作，不重新寻找凭证、猜测 API 字段或照搬其他数据库模式。

## 1. 已确认的环境与工具

| 项目 | 本次实测值 | 复用注意 |
| --- | --- | --- |
| 工作目录 | `/Users/baojie/dev/wedding-planner` | 下方脚本命令均从仓库根目录运行 |
| CloudBase 环境 | `dev-d1gh3jw1gdf06af22` | 来自来源仓库生产配置；名字含 dev 不代表独立测试环境 |
| 地域 | `ap-shanghai` | 下方手动 CLI 命令及服务端 SDK 明确使用上海；cloudApi 辅助函数也已显式固定上海，跨地域复用需调整并验证 |
| CLI | 全局 `3.8.5`，本机 `/opt/homebrew/bin/tcb` | 先 `command -v tcb`，不继续使用先前 npx 缓存的 3.6.4 路径 |
| Node | `25.8.1` | 仓库脚本基线为 Node 22.18+；其他版本不能直接当作实测通过 |
| 服务端 SDK | `@cloudbase/node-sdk@3.18.3` | 管理员凭证只在服务端脚本中使用 |
| 客户端 SDK | `@cloudbase/js-sdk@3.6.3` | 匿名权限验证使用，与来源项目一致 |
| Node 客户端测试依赖 | `ws@8.22.0` | 缺失会在导入 JS SDK 的 Node 入口时直接报错 |
| 客户端公开配置来源 | `/Users/baojie/Downloads/同步空间/家人/zty/wedding_project/.env.production.local` | 读取 `VITE_CLOUDBASE_ENV_ID/REGION/PUBLISHABLE_KEY`，不整文件打印 |

当时环境为体验版、Normal，显示到期时间 2027-01-20 23:59:59。操作前重新读取状态与配额，不能把历史记录当作当前有效性保证。原资源基线为 `weddings` 集合 1 条记录、33,256 字节，函数列表为空；这是创建探针集合之前的观察值。

## 2. 登录复用：先验证，不先要求用户重新授权

按顺序执行只读检查：

```sh
command -v tcb
tcb --version
tcb env list --region ap-shanghai
```

能看到目标环境即先复用现有登录。`npm install -g @cloudbase/cli` 是安装工具，`npx @cloudbase/cli login` 是另一种启动工具的方式，二者不决定凭证是否一次性。只有未安装 CLI 时才按官方安装流程安装；不要每轮自动安装最新版本。

本次重要故障：受限执行模式下，CLI 报 `No valid identity found`，但用户已经在终端登录。允许网络访问及 CLI 正常刷新/保存状态的执行模式下，同一个 `tcb env list` 立即成功。因此：

1. 核对当前系统用户、`tcb` 路径、版本、工作目录与地域是否一致。
2. 排除沙箱网络、凭证刷新或配置目录写入受限；在执行平台允许的权限流程内重试同一个只读命令。
3. 正常执行模式仍确认凭证失效时，才请用户运行 `tcb login`，完成浏览器身份验证。
4. 不根据 CLI 附带的更新检查警告盲目执行 `sudo`、递归 `chown`，也不要自行改 HOME 或复制凭证到仓库。

登录授权会保存，并可在有效条件下刷新；这不等于永久登录。过期、撤销或本机凭证丢失仍可能需要用户重新登录。执行平台的网络/文件权限，与腾讯云账号登录是两层机制，不能互相替代。

本次没有创建长期 API Key：已靠现有登录的临时凭证完成验证。官方安装页与 API Key 页对服务端 API Key 开放状态存在差异，未实测的长期凭证路线不要当作既定操作。前端 Publishable Key 不是管理员凭证。

## 3. 在本机脚本内复用临时凭证

直接复用 [cloudbase-cli.mjs](../../scripts/fusion/cloudbase-cli.mjs) 的 `temporaryCredential(env)`，不要重新实现读取 CLI 私有配置文件的逻辑。

该函数通过子进程运行 CLI 的 `secrets get --json`，捕获输出到内存，验证 `isTemporary` 和必需字段，并把 CLI 的 `token` 映射为服务端 SDK 的 **`sessionToken`**。它不把密钥放进子进程命令参数、控制台或报告，也不在仓库写凭证文件。

```js
import cloudbase from '@cloudbase/node-sdk'
import { temporaryCredential } from './scripts/fusion/cloudbase-cli.mjs'

const env = 'dev-d1gh3jw1gdf06af22'
const db = cloudbase.init({
  env,
  region: 'ap-shanghai',
  ...temporaryCredential(env),
}).database()
```

以上为仓库根目录模块的用法示意，真实实现见现有探针。不要直接在助手工具里执行会打印密钥的 `tcb secrets get`，不要把其原始 stdout/stderr 或 SDK 请求对象粘贴到日志。无需请用户发送 SecretId、SecretKey、验证码或 Token。

CLI JSON 常有 `{ "data": ... }` 外层；现有辅助函数已兼容这一层并屏蔽原始失败输出。它返回的 `CLOUDBASE_CLI_FAILED_CHECK_LOGIN_AND_NETWORK` 是概括错误，不能仅凭这个错误就断言“用户没登录”。必要时单独重跑不含秘密的环境列表/API 请求定位。

## 4. 查资源、隔离创建、设置权限并读回

先查环境中的函数与集合；这些命令不修改数据：

```sh
tcb fn list -e dev-d1gh3jw1gdf06af22 --region ap-shanghai

tcb api tcb DescribeTables --region ap-shanghai --body '{"EnvId":"dev-d1gh3jw1gdf06af22","MgoLimit":100,"MgoOffset":0}' --json
```

`DescribeTables` 使用 **`MgoLimit` / `MgoOffset`**，不是通用的 `Limit` / `Offset`。错误字段曾返回 MissingParameter。读回 `Pager.Total` 判断分页完整性：当前探针最多检查 100 个集合，超过会停止；迁到集合更多的环境时须补分页，不能只看第一页就认定名字未使用。

本次验证资源清单：

| 集合 | 用途 |
| --- | --- |
| `planner_fusion_probe_access` | 虚构项目的协作/管理凭证摘要 |
| `planner_fusion_probe_current` | 虚构当前状态与代次 |
| `planner_fusion_probe_receipts` | 幂等回执 |
| `planner_fusion_probe_activity` | 每日活动计数 |
| `planner_fusion_probe_history` | 日结、跨文档恢复和 90 份快照样本 |

创建新集合、设置和读回权限使用以下已实测 API。这里只以**明确属于本任务的测试集合**为例，不要替换成原业务 `weddings` 集合运行：

```sh
# 仅在已确认目标测试集合不存在时创建；已有集合先核对归属
tcb api tcb CreateTable --region ap-shanghai --body '{"EnvId":"dev-d1gh3jw1gdf06af22","TableName":"planner_fusion_probe_current"}' --json

# 先限制访问，确认后再写入虚构样本
tcb api tcb ModifyDatabaseACL --region ap-shanghai --body '{"EnvId":"dev-d1gh3jw1gdf06af22","CollectionName":"planner_fusion_probe_current","AclTag":"ADMINONLY"}' --json

tcb api tcb DescribeDatabaseACL --region ap-shanghai --body '{"EnvId":"dev-d1gh3jw1gdf06af22","CollectionName":"planner_fusion_probe_current"}' --json
```

必须读回 `AclTag: ADMINONLY`，再以匿名客户端实测拒绝；管理员 SDK 读写成功不证明客户端权限正确。本次确实应用的是 ACL 接口，仓库 [fusion-probe.rules.json](../../cloudbase/fusion-probe.rules.json) 只记录全拒绝意图，不是已上传的自定义规则证据。

`ADMINONLY` 保护客户端直读/直写；服务端管理员 SDK 仍能访问。项目级协作/管理凭证校验必须由 [命令服务](../../server/fusion/commandService.ts) 完成，不能用管理员 SDK 的成功访问替代项目授权测试。

## 5. 一次完整的可重复验证

先从锁文件准备依赖并做本地检查；无需为探针重新全局升级 SDK：

```sh
npm ci --ignore-scripts
npm run test:fusion
npm run typecheck:fusion
npm run build
npm run lint
```

下面是真实云端操作，会创建缺失的上述测试集合、设置它们的 ADMINONLY 权限、写入新的虚构样本。**不是 dry-run，也不要放进每次运行的普通单元测试。** 当前三个脚本明确限制目标环境；跨项目复用前要审查环境保护条件、集合命名和资源归属，不能直接删除这些保护。

每轮使用新的输出目录。报告以 `wx` 写入：若旧报告已存在，会拒绝覆盖，但检查发生在最终写报告时，**不能因此认为前面的云端操作没有发生**。

```sh
fusion_probe_dir=$(mktemp -d /private/tmp/planner-cloudbase.XXXXXX)

node --experimental-strip-types scripts/fusion/probe-cloudbase.mjs \
  dev-d1gh3jw1gdf06af22 "$fusion_probe_dir/transactions.json" --isolated-probe
```

先检查该命令成功退出，且报告 `status` 为 `PASS`，再运行依赖它的客户端权限验证。三个命令分别执行，不因前一步失败而盲目继续：

```sh
node --experimental-strip-types scripts/fusion/probe-client-permissions.mjs \
  '/Users/baojie/Downloads/同步空间/家人/zty/wedding_project/.env.production.local' \
  "$fusion_probe_dir/transactions.json" "$fusion_probe_dir/client-permissions.json"
```

最后运行独立的历史能力/容量探针：

```sh
node --experimental-strip-types scripts/fusion/probe-history-cloudbase.mjs \
  dev-d1gh3jw1gdf06af22 "$fusion_probe_dir/history.json" --isolated-probe
```

| 探针 | 必须看到的证据 | 不能据此宣称 |
| --- | --- | --- |
| 事务 | 5 项通过：并发幂等、权限、失败回滚、虚构座位竞争、撤销及旧代次回执 | 业务云函数已部署、完整宾客/住宿模型已实现 |
| 客户端权限 | `anonymousLogin: PASS`；四个集合 × 五种操作共 20 项 `denied: true`，错误码为 DATABASE_PERMISSION_DENIED | 图片权限、函数网关或第五个 history 集合已做同样客户端实测 |
| 历史 | 4 项通过：固定跨日状态、失败回滚、核心与 20 篇笔记恢复、90 份样本与分页 | 定时调度、任意规模恢复、图片保留或生产负载已通过 |

失败时先读 `failedStage`、`errorCode`、`transactionStep`；保留失败报告。新报告使用新路径，记录具体修正，不覆盖旧失败证据。脚本有退出码，不要仅凭最后一行输出或某几项 passed 判断整轮成功。

## 6. 本次发现的 SDK 与事务约束

### 事务内必须顺序读写

目标环境在同一事务内 `Promise.all` 读取 20 篇笔记，返回 `DATABASE_TRANSACTION_FAIL`，详细原因是 `ResourceUnavailable.TransactionBusy`。改为顺序读取后，同样规模的日结和恢复通过。**不同事务可以并发测试，同一事务内的文档访问不要并发。**

```js
const notes = []
for (const noteId of noteIds) {
  const result = await transaction.collection(collection).doc(noteId).get()
  if (result.code) throw new Error('DATABASE_READ_FAILED')
  notes.push(result.data)
}
```

事务回调可能被 SDK 重试，里面只放受事务保护的读写与纯计算；不要发送外部消息或调用其他服务。本项目业务冲突不能自动换成最新 revision 覆盖，响应丢失按原 operationId 查回执。

官方文档列出 100 次操作、30 秒等事务限制，属于规划上限；本次未测极限。当前 20 篇笔记成功不等于任意笔记数都能放在一个事务里，大规模恢复仍需验证隐藏代次准备与原子切换。

### SDK 返回格式与错误检查

| 边界 | 本次核对到的行为 | 实现要求 |
| --- | --- | --- |
| Node SDK 普通文档 get | `result.data` 为数组 | 不能按事务的单对象形状解码 |
| Node SDK 事务内 doc.get | `result.data` 为文档对象或 null | null 才是不存在；错误不能伪装成空记录 |
| Node SDK 操作失败 | 可能返回带 `code` 的结果，而不是抛异常 | 调用后检查错误码；适配器已有检查 |
| JS SDK 3.6.3 set/update/remove | 权限被拒绝时，部分接口仍 resolve，返回 undefined 的 updated/deleted，省略错误码 | 不用“未抛异常”作为已同步证据；以服务端命令回执确认 |
| JS SDK 权限探针 | 需要在传输边界提取数据库错误码，才能核实上述写入拒绝 | 这是限定版本诊断，不是稳定公开接口；SDK 升级后重验 |

权限探针先完成匿名登录，再区分实际 `DATABASE_PERMISSION_DENIED` 与网络失败/接口调用错误。无错误码、未知结构或 undefined 写入结果都不能直接算通过。为避免日志泄漏，探针只记录错误码、字段类型和必要的脱敏诊断，不记录网络请求对象。

排查安装包时从实际入口追踪：本版本 `@cloudbase/database/dist/commonjs/index.js` 使用 `transaction/index.js`。包中还有旧的同名 `transaction.js`，仅阅读它会误判当前事务实现。复用 [适配器](../../server/fusion/cloudBaseTransactionStore.ts) 和 [SDK 边界测试](../../tests/fusion/cloudBaseAdapter.test.mjs)，不要凭类型定义猜返回值。

## 7. 故障速查

| 现象 | 优先检查与处理 |
| --- | --- |
| 用户终端已登录，助手仍显示未登录 | 先排除受限网络、刷新/配置写入权限、CLI 路径和系统用户差异，再要求重新登录 |
| `DescribeTables` 缺少 MgoLimit | 使用 MgoLimit/MgoOffset，并核对 Pager.Total |
| `Cannot find package 'ws'` | 按仓库锁文件恢复依赖；本次 JS SDK 的 Node 入口需要 ws |
| 读被拒绝，写似乎正常返回 | 核对底层错误码与写入字段；本版本 SDK 会省略部分写入拒绝码 |
| TransactionBusy | 删除同一事务内并发访问；不要把业务 revision 冲突一并改成盲目重试 |
| 报告路径已存在 | 换新输出目录；此前云端请求可能已执行，不当作全程未执行 |
| 报告没有生成 | 参数检查/模块导入/配置读取可能在报告 try 块之前失败；查看退出码和脱敏终端错误 |
| 集合超过 100 个 | 当前探针会停下；完善分页后再判定测试集合是否存在 |
| CLI 的通用错误链接与实际接口不符 | 以对应官方 API 页、本机 CLI 实现和具体返回字段核对，不沿错误链接猜字段 |
| npm audit 建议降级 SDK 或 force fix | 先检查依赖链和兼容性，保留固定版本验证；不盲目全仓库改依赖 |

## 8. 样本、证据和后续边界

事务探针使用随机 `fixtureProjectIds`，历史探针使用随机 `runId`，文档键由固定编码再哈希生成。脚本不会自动清理；重跑会累计样本，失败运行也可能留下已提交的初始化数据。只核对和清理明确属于该次运行的记录，禁止按整个集合或无条件查询删除。当前没有经过验收的自动清理脚本，清理前先查看报告与集合里的运行归属，不猜测失败运行没有副作用。

2026-10-04 证据：

- [5 项真实事务验证](../validation/2026-10-04-cloudbase-transactions.json)
- [20 项匿名客户端权限拒绝](../validation/2026-10-04-client-permissions.json)
- [事务内并发读取失败](../validation/2026-10-04-history-parallel-failure.json)
- [顺序访问后的历史/容量结果](../validation/2026-10-04-history-serial.json)
- [分阶段验证总记录](../validation/planner-fusion-validation.md)

本次 150 位虚构宾客、20 篇笔记、无图片的样本：单份快照 JSON 为 49,375 字节，90 份正文估算 4,443,750 字节，历史 20 条元数据读取约 46 ms。实际写入过 90 份样本；数字不含索引、图片、回收站及计费开销。日结/恢复耗时约 1.78–2.44 秒，包含本机到云端及读回断言，不能当作生产页面延迟或 SLA。

仍需继续验证的内容：云函数部署/调用网关、项目链接到访问会话的完整链路、图片上传与临时链接撤销、订阅/轮询、日结故障恢复与定时器、事务大小边界、跨代次发布、保留期清理、真实移动端和生产迁移。第一批事务探针只查阅过 `tcb fn deploy --help`，当时没有实际部署函数；后续隔离函数部署与网关验证见第 9 节，不等于业务函数发布。服务端 SDK 依赖审计告警仍见验证记录，上线前需要处理。

官方参考（版本变化时用来复核，不替代本项目实测）：[CLI 安装与登录](https://docs.cloudbase.net/cli-v1/install)、[数据库事务](https://docs.cloudbase.net/database/transaction)、[设置数据库权限](https://cloud.tencent.com/document/product/876/34819)、[读取数据库权限](https://cloud.tencent.com/document/product/876/34821)、[部署云函数](https://docs.cloudbase.net/cli-v1/functions/deploy)。

## 9. 隔离云函数部署与网关验证（2026-10-04 新增）

本轮新增的 `planner-fusion-gateway-probe` 是 Event 验证函数，业务页面不调用它；授权范围固定为构建清单中的两个虚构项目。不要使用 `--all` 或部署整个仓库。

```sh
# 目录必须尚不存在；每次构建生成两个新的虚构项目 ID
node scripts/fusion/build-probe-function.mjs /private/tmp/planner-gateway-<unique-id>

# 必须从生成目录执行，配置中的 functionRoot 保持相对路径
cd /private/tmp/planner-gateway-<unique-id>
tcb fn deploy planner-fusion-gateway-probe --region ap-shanghai --install-dependency false --json
```

重新部署自己已确认归属的同名探针才加 `--force`；先读回函数状态与配置。配置中 `Nodejs20.19`、`index.main`、20 秒和 256 MB 已实测创建成功。依赖内联在约 1.96 MB JS 中，不在云端重新安装，源 SDK 为 3.18.3；`manifest.json` 记录 bundle SHA-256 和项目 ID，不含项目秘密。

CLI 3.8.5 即使指定别处的 `--config-file`，相对 `functionRoot` 仍可能相对当前工作目录解析。本次因此先出现目录不存在；进一步测试发现绝对路径也被拼接到当前目录，仍会失败。最终保留相对 `functionRoot`，从配置所在的生成目录运行部署。上传前确认实际目录只含部署产物，不含 `.env`、CLI 凭证或来源数据。

本地 SDK 的部分数据库类型定义不一致：`cloudbase.init().database()` 的返回类型与旧 `types/db.js` 中完整 Db 的 Geo 成员不匹配。适配器改用实际 init 返回的数据库类型，事务参数仍显式使用 SDK Transaction 类型；没有通过关闭严格检查处理。

### 部署成功不等于客户端可调用

2026-10-04 首轮匿名登录成功，`callFunction` 仍返回 `EXCEED_AUTHORITY`。该错误可能作为结果对象的顶层 `code` 返回，不能只捕获异常或直接取 `result`。新探针已检查它。

权限放行后的第二轮发现：函数把业务错误返回为 `{ ok: false, code: "FORBIDDEN" }` 时，客户端也得到顶层 `code`，无法按正常 `result` 处理负向用例。最终改为 `{ ok: false, error: { code: "FORBIDDEN" } }`；真实浏览器验证通过。不要把业务码和网关传输码放在同一层。首次和第二次失败报告都保留，不改写为 PASS。

只读排查命令：

```sh
tcb fn detail planner-fusion-gateway-probe -e dev-d1gh3jw1gdf06af22 --region ap-shanghai --json
tcb api tcb DescribeResourcePermission --region ap-shanghai --body '{"EnvId":"dev-d1gh3jw1gdf06af22","ResourceType":"function"}' --json
tcb policy get -e dev-d1gh3jw1gdf06af22 --region ap-shanghai --json
```

`fn detail` 可能包含环境变量，其他函数可能在其中配置秘密；助手不能无筛选地打印未知函数配置。本次探针只配置环境 ID、虚构项目 ID 和日志开关，因此读回安全。

已读回默认函数规则为 `auth != null && auth.loginType != 'ANONYMOUS'`。经用户明确批准、已应用并读回的最小变更如下：

```json
{
  "*": { "invoke": "auth != null && auth.loginType != 'ANONYMOUS'" },
  "planner-fusion-gateway-probe": { "invoke": "auth != null" }
}
```

本次自动审批最初拒绝，用户随后明确授权仅修改该函数，才完成变更。类似变更必须在已授权范围内执行。使用 `configure-probe-function-permission.mjs <fresh-report.json>`：先保存/再次核对原规则，只追加探针例外，调用 `ModifyResourcePermission`，随后读回对比。该 API 的函数规则是环境级完整配置，不能用只有探针项的 JSON 覆盖其他项。脚本不修改默认项、不开放无登录调用，也不迁移到 OPA；`tcb policy set` 会停用旧网关授权，不能作为这里的快捷修复。该脚本已实测通过，见[权限变更报告](../validation/2026-10-04-function-permission.json)。

规则放行只允许请求到达函数，项目级凭证仍在每次读取/修改/回执查询时校验。探针内没有记录请求或原始 SDK 错误；部署配置同时设置 `LOG_EVENT_CONTEXT/LOG_HEADER_BODY/LOG_CONTENT_ENABLED=false`。这些开关已读回，但不能据此宣称所有平台日志层已无秘密，正式链接交付前仍需验证。

回到仓库根目录运行探针：

```sh
node --experimental-strip-types scripts/fusion/probe-function-gateway.mjs \
  '/Users/baojie/Downloads/同步空间/家人/zty/wedding_project/.env.production.local' \
  /private/tmp/planner-gateway-<unique-id>/manifest.json \
  /private/tmp/planner-gateway-<unique-id>/gateway-result.json
```

此脚本先以独占方式创建报告文件再操作云端，读回实际部署的项目白名单和状态，核对后才准备样本。两个 fixture 必须尚不存在；失败时也保留其项目 ID。项目秘密只留在进程内，因此失败后不能靠报告重建原凭证；复测应新建清单、重新部署匹配的项目白名单，并保留旧失败证据，不覆盖旧样本。首轮失败已保存于 [函数网关报告](../validation/2026-10-04-function-gateway.json)。

通过标准：有效凭证读取、错误/跨项目拒绝、管理命令隔离、丢弃响应后原 ID 幂等、撤销后读取和回执拒绝。**Node 中的 JS SDK 测试不等于浏览器测试；模拟丢弃响应不等于真实网络断线。**

真实浏览器模式：在以上命令末尾添加 `--browser`，等待终端显示 `http://127.0.0.1:4179`，在浏览器打开并点击“开始验证”。5 组断言由同一脚本执行，云端调用由浏览器 JS SDK 实际发送，支持并发重试。页面最终显示 PASS 和请求次数；本地 relay 随后自动关闭。监听仅在本机、带 Origin/Host/随机 nonce 校验，凭证不落盘或出现在 URL；报告和页面只展示脱敏结果。不要把这个验证服务作为业务服务部署。

2026-10-04 [真实浏览器报告](../validation/2026-10-04-function-gateway-browser.json)与[截图](../validation/2026-10-04-function-gateway-browser.png)确认 21 次请求、5 组通过；[最终部署读回](../validation/2026-10-04-function-deployment.json)记录实际运行时与授权规则。该结果不覆盖建项目、真实页面、文件或日结机制。 CLI 管理员 invoke 可以用于运行时检查，但不能证明匿名客户端网关已放行。

接口依据：[函数规则](https://docs.cloudbase.net/cloud-function/security-rules)、[读取资源权限](https://cloud.tencent.com/document/product/876/132256)、[修改资源权限](https://cloud.tencent.com/document/product/876/132255)。这里记录的是本环境原有函数规则机制，后续环境如果已经使用 OPA，必须先重新核对权限模型。

## 10. 图片存储探针与 PRIVATE 权限旁路（2026-10-04）

先用 `tcb storage rules get -e dev-d1gh3jw1gdf06af22 --region ap-shanghai --json` 读取基线。本环境为 PRIVATE。旧 `storage get-acl` 已废弃；直接调用 `DescribeStorageSafeRule` 需要正确的 Bucket 参数，只有 EnvId 会失败，不能把辅助函数的概括错误误判为登录失效。

本轮桶为 `6465-dev-d1gh3jw1gdf06af22-1456231968`，地域上海；标识从 `DescribeEnvs` 的 Storages 提取，没有读取旧文件内容。探针使用 `cloud://<env>.<bucket>/planner_fusion_probe_images/<new-project-id>/pixel.png`，实际 uploadFile 返回值会逐项核对，不靠拼接值直接宣称上传成功。

### 已发现的绕过路径

浏览器以匿名身份调用云函数上传后，再绕过业务函数，直接调用 JS SDK `getTempFileURL`，实测成功。最初怀疑与创建者权限有关，但下述独立服务端上传对照已否定“只改变上传身份即可隔离”的假设；项目秘密校验无法阻止已经实测成功的直连取 URL。必须额外限制业务图片目录的客户端权限。规则属于整个环境配置，不能把整个桶改为 ADMINONLY 而不考虑来源文件。

候选修复与原规则保存在 [规则变更失败记录](../validation/2026-10-04-storage-permission.json)。用户已明确授权该范围及失败恢复；[授权后重试](../validation/2026-10-04-storage-permission-authorized.json)返回 `OperationDenied.FreePackageDenied`，再次读取仍为 PRIVATE。当前套餐是这条自定义规则修复路线的实际阻塞，不能继续当作表达式语法或登录问题反复尝试。需在支持自定义规则的环境中保留原规则并验收受限目录与目录外的创建者行为；失败按授权恢复原规则。不得把候选规则或本地表达式推导写成远端已生效。

### 复用步骤

1. 用第 9 节构建脚本生成全新项目清单，从生成目录部署探针；原两个项目只作为历史证据，不覆写其样本。
2. 从仓库根目录运行下列脚本，打开提示的本机地址，点击开始验证。
3. 核对报告每项结果和浏览器最终状态；首次报告在直读旁路处失败，后续删除与撤销项不能因此算通过。

```sh
node --experimental-strip-types scripts/fusion/probe-image-storage.mjs \
  '/Users/baojie/Downloads/同步空间/家人/zty/wedding_project/.env.production.local' \
  /private/tmp/<fresh-deployment>/manifest.json /private/tmp/<fresh-report>.json
```

此探针只接受仓库内固定的 1 像素 PNG 和两条明确路径；服务端上传/下载/删除均先校验项目，I/O 后再次鉴权才返回内容。读取中撤销有本地测试覆盖，但外部存储写入不属于数据库事务，不能据此承诺业务上传/删除完全原子。真实附件生命周期仍要用元数据、引用与幂等协议实现。

`uploadFile/downloadFile/deleteFile` 的 TypeScript 声明不包含所有运行时 `code` 返回，实际实现仍需检查返回式错误。删除还要逐项检查 fileList 的 code，不能把 HTTP 成功当作文件已删。

临时链接到期可独立运行 `probe-image-url.mjs <manifest.json> <fresh-report.json>`，只读指定虚构像素文件，申请 maxAge=15 秒，验证内容并等待 21 秒后重新请求；URL 全程只在进程内。本轮[到期测试](../validation/2026-10-04-image-url-expiry.json)未通过：21 秒后仍返回 200。[后续对照](../validation/2026-10-04-image-url-cache.json)确认无签名为 403，签名请求的缓存 Date 未变、Age 增长；不能把它解读为已确定永久公开，也不能声称 15 秒已生效。签发者 SDK、存储规则、请求有效期和实际 HTTP 状态必须同时记录，不凭 URL 名字推断它一定会过期。正式用户链接有效期尚未据此确定。

参考：[SDK 文件管理](https://docs.cloudbase.net/storage/sdk)、[存储安全规则](https://docs.cloudbase.net/storage/security-rules)。

平台失败时辅助脚本必须记录脱敏机器错误码。本次第一次存储规则脚本只写 FAIL，隐藏了套餐问题；已修正为捕获 CLI JSON 的 `error.code`，不保存原始 SDK 请求或签名。`OperationDenied.FreePackageDenied` 与身份过期、网络失败、规则语法错误不同；先解决环境能力，不要求用户重复登录。


### 独立服务端上传对照：仍不能封闭直读

[2026-10-04 对照报告](../validation/2026-10-04-server-owned-storage.json)由本机 Node SDK 使用 CLI 临时管理员身份上传全新固定像素文件，完全不经过云函数或浏览器用户上下文。随后真实浏览器匿名登录，不提交项目秘密，直接用已知 fileID 调用 `getTempFileURL`：返回 SUCCESS，下载 HTTP 200，逐字节匹配原图。这证明单独改成服务端上传不满足当前环境的项目图片隔离要求；并不证明可以枚举或读取未知 fileID。

匿名直接删除明确返回 `STORAGE_EXCEED_AUTHORITY`。覆盖请求没有取得明确错误码或 fileID，状态不确定，不能算作拒绝成功。管理员清理本轮唯一新文件返回 SUCCESS。原业务文件与权限未改动。

仅在本地核对公开 JWT 的非敏感声明：`is_system_admin=false`、`client_type=client_user`、`scope=anonymous`，未记录密钥。未发现管理员密钥误放前端的迹象；声明检查不能替代平台授权诊断。

复用：运行 `node --experimental-strip-types scripts/fusion/probe-server-owned-storage.mjs <public-env-file> <fresh-report.json>`，打开脚本提示的本机页面并点击开始验证。脚本只创建随机路径的固定虚构图片。报告需逐项核对；旧版报告进程退出为 0 不代表隔离通过，后续脚本已改为未证明隔离通过时非零退出。异常中断后的文件清理以报告为准。

结论：没有证明必须升级才能实现全部需求。已证明受套餐限制的是 CUSTOM 规则变更，服务端上传替代路线也未通过。图片隔离、链接到期及权限撤销仍未验收；其余数据库/网关结论不受这项失败自动否定。下一步需确定能封闭直读的受支持存储方案，再继续真实附件开发，不将随机路径或仅改前端 API 当成权限边界。


## 11. 结构化主流程验证（当前优先）

2026-10-04 用户收敛范围：停止图片探索，第 10 节仅保留历史排查证据，不作为继续开发或套餐升级的前提。

1. `node scripts/fusion/build-probe-function.mjs /private/tmp/<fresh-core-run>` 生成全新项目与函数包。
2. 进入该临时目录，按第 9 节部署同一已授权验证函数。
3. 仓库根目录执行：

```sh
node --experimental-strip-types scripts/fusion/probe-core-flow.mjs \
  '/Users/baojie/Downloads/同步空间/家人/zty/wedding_project/.env.production.local' \
  /private/tmp/<fresh-core-run>/manifest.json /private/tmp/<fresh-core-report>.json --browser
```

4. 打开本机提示地址，点击开始验证。5 组覆盖新增宾客/桌/房/晚次、抢座及摘要回执、个人住宿日期/布局/独立客户端回读、项目隔离/旧版本冲突，以及 shared/显式顺序/有损清空拒绝。
5. 报告必须 PASS；不复用已落库的项目，不输出分享秘密。保留固定虚构数据作为证据。浏览器写入加另一 Node SDK 读取不等于正式页面或手机验收。

当前 gateway 同时接受隔离项目的结构化命令；旧数值探针仍可复用。正式页面发布前仍需日结/恢复材料、创建入口、队列与页面接线；不把隔离函数当正式业务入口。


## 12. 实际页面本机验证

先构建并部署全新隔离项目清单（第 11 节），然后从仓库根目录运行：

```sh
node --experimental-strip-types scripts/fusion/preview-core-ui.mjs \
  '/Users/baojie/Downloads/同步空间/家人/zty/wedding_project/.env.production.local' \
  /private/tmp/<fresh-ui-run>/manifest.json
```

脚本只绑定 `127.0.0.1:4180`，验证函数白名单和集合 ADMINONLY 后写入全新虚构项目，拒绝覆盖旧样本。打开 `/__fusion_fixture` 点击“打开测试项目”进入真实三页。凭证仅保留在脚本内存与本机浏览器会话，专用引导端点要求本机 Host、同源 Origin 和随机 nonce；不输出凭证，不部署该辅助端点。原生产数据与权限不变。结束用 Ctrl-C 停止该本机进程。

正常配置入口使用 `VITE_FUSION_ENV_ID`、`VITE_FUSION_PUBLISHABLE_KEY` 和可选 `VITE_FUSION_FUNCTION`。项目链接片段 `#key=...` 进入后转入 sessionStorage 并清除地址栏片段；在项目创建/链接交付完成前，不以手工猜测 projectId 当作创建项目。


## 13. 项目创建入口

本机预览 `/fusion` 可创建 `fusion-created-<requestId>` 隔离项目；服务端不再只允许预置的两个 UI 项目，但新 namespace 仍使用 `planner_fusion_probe_*` 集合，读写始终验证项目秘密。每日全局 20 个新项目是开发保护，不能当作正式防滥用配置。创建和额度更新为同一事务，不在失败后补写权限。

修改已存在虚构 UI 项目的功能时，可用新 staging 构建函数，然后明确保留原 manifest 的 projects 到 cloudbaserc 环境变量及新 manifest，并记录 fixtureMode 为 CONTINUE_EXISTING_SYNTHETIC_UI_PROJECT。不要重跑 seed 脚本覆盖已有样本；原包及新包 SHA 分别保留。Vite 热更新不会替换所有已创建 store 的闭包，验证新动作前先整页重载。


## 14. 结构化回收与换座验证

本轮使用 `scripts/fusion/probe-recycle-flow.mjs <配置文件> <部署 manifest> <新的报告路径>`，以匿名 JS SDK 调用已经部署的隔离函数；通过 `project.create` 新建 `fusion-created-*` 纯虚构项目，秘密只保留在进程内。检查原子换座、重复命令回执、删桌关联、列表/恢复与错误凭证拒绝，不覆写现有 fixture 或来源婚礼数据。报告路径独占创建，避免覆盖此前证据；失败只报告阶段，不输出凭证或原始 SDK 异常。

部署沿用原 UI fixture 时，从旧 manifest 保留两个白名单项目 ID，并同步写入新 staging 的 `FUSION_PROBE_PROJECTS`。运行新的验证脚本不会重新播种这两个项目。新云函数只更新代码，不修改已有 invoke、数据库或存储规则。

浏览器原生 confirm 若导致工具超时，先检查 dialog API 与实际页面，不能盲目重试删除。2026-10-04 在 IAB 出现 dialog API 返回 undefined、页面查询超时，SDK 验证已通过但 UI 完整验收仍待补；两类证据须分开记录。


2026-10-05：`probe-recycle-flow.mjs` 已增加文本笔记删除恢复和已删除 ID 复用拒绝。笔记删除不增加核心 snapshotRevision，验证时同时核对 notesRevision 和恢复后的 note.revision；恢复回执重试仍只执行一次。当前删除以事务写入空正文 payload 实现，索引 retiredIds 必须保留，不能在适配器读取/后续更新时丢弃。该实现复用原隔离集合，不需要新增权限。


住宿有损操作已纳入同一 `probe-recycle-flow.mjs`：验证 `stayDate.remove` 删除/恢复宾客晚次，`guest.clearStayNeed` 清除/恢复房间、晚次和独立需求。恢复命令必须使用删除后的配置/宾客 revision，不可沿用删除前的版本；查询列表也需走当前凭证鉴权。只操作脚本新建的虚构项目。


## 15. 手动项目版本

`version.save` 必须携带 `expectedRevisions.snapshot` 与 `expectedRevisions.notes`，值来自同次已同步读取。服务端在单事务中保存 core 和完整文本 notes，操作 ID 绑定回执；不要为结果未知的重试生成新操作 ID。目录通过 `history.list` 返回最多 20 条元数据，后续传回 nextCursor；`history.read` 按 ID 读取正文，始终用当前项目凭证。手动版本保存不需要管理凭证，但未来整项目恢复必须检查管理权限。

`probe-recycle-flow.mjs` 已增加手动快照冻结、幂等、后续编辑不改变版本以及错误凭证读取拒绝回归。数据仍使用 ADMINONLY 的原隔离 current 集合，文档键区分 history-index 与 version，不修改权限。该验证只证明虚构小项目；多笔记大项目/90天快照容量另需实测。


## 16. 整项目恢复与未知结果

`version.restore` 只接受当前管理凭证，并携带预览时的核心/笔记 revision。旧目标版本自身不携带权限。服务端自动生成安全版本，再在事务里恢复核心和笔记、切换 dataEpoch；调用方不得自行逐条覆盖可见业务文档。

回执的 `dataEpoch` 仍是原请求代次，`resultDataEpoch` 是恢复后的新代次。响应丢失后按原 projectId/dataEpoch/operationId 查回执，并核对完整 requestDigest；不能用新 ID 再恢复。重开后旧代次草稿只能查已成功回执，未成功者保留人工核对，不能重放到新代次。探针脚本已覆盖管理恢复、安全版本、回执重试及旧代次写入拒绝。


## 17. 日结检查与模拟跨日验证

所有结构化业务写入均在提交事务内部调用同一日结检查，先固定上一活跃日、再写新日状态；不得绕过检查逐个更新核心/笔记。日结标记是 current 隔离集合中 `daily-state` 类型的单条项目文档；其 kind 用于未来私有定时入口限批查询，不是前端可写开关。

`probe-recycle-flow.mjs` 增加 simulated / seeded prior-day 测试：只对本次脚本随机创建的 `fusion-created-*` 虚构项目，使用 CLI 临时凭证把日结标记设为前一天，再通过匿名客户端调用已部署业务命令，核对封存内容恰为修改前核心和笔记。报告项 `seeded_prior_day_rollover_preserves_core_and_notes` 证明真实云数据库事务与已部署屏障，不等同于真实午夜或定时触发器验收。不得把真实婚礼项目用于这种时间标记注入。

CLI 3.8.5 的 `tcb fn trigger create --help` 显示支持 `--trigger-name` 和七字段 `--cron`，官方内置示例每小时为 `0 0 * * * * *`。当前尚未创建触发器；定时函数须保持私有，不沿用 gateway 的匿名 invoke 开放规则。


## 18. 后台日结触发器

构建专用包：`node scripts/fusion/build-probe-function.mjs <新的 staging 目录> --daily`，输出 `planner-fusion-daily-probe`。部署前将 manifest 与配置中的白名单项目替换为已有 UI 测试 manifest 的两个 ID；保留 `fusion-created-*` 隔离新建项目。该函数不接受客户端提供的项目或时间，单批最多 20 个，只查询 current 隔离集合中 `payload.kind=daily-state`、未封存且业务日期已过去的项目。

已创建 `planner-daily-hourly`，七字段 Cron 为 `0 23 * * * * *`，即每小时第 23 分钟补偿处理。任务会跳过同日和已封存项目；跨日业务写入仍有事务内屏障兜底，不能依赖单次触发准时执行。

真实调度验证使用 `probe-daily-schedule.mjs <daily manifest> <fresh report>`：随机创建纯虚构项目并写入模拟前一天的宾客和笔记，之后只读等待最多 3 分钟，绝不手动 invoke。选择触发时间后须在触发前完成播种。真实触发完成与模拟业务日期须分别记录，不将模拟数据当作真实婚礼日期。

安全边界：环境默认规则为 `auth != null && auth.loginType != 'ANONYMOUS'`，新函数没有例外，因此匿名客户端被拒绝，但非匿名客户端仍受默认允许规则覆盖。将该函数单独收紧为 `invoke: false` 的动作被自动审批拒绝，理由是此前用户明确授权仅涉及 gateway；已向用户提出具体确认，尚未执行。待用户确认后才可运行 `secure-daily-function.mjs <fresh report>`，该脚本备份和两次核对原规则，只改新定时函数项，不覆盖其他规则。不得把当前默认规则描述成所有客户端均不可调用。


### 18.1 失败项目不阻塞后续批次

2026-10-05 审查后，worker 新增 `planner_fusion_probe_current/planner_fusion_daily_scan_cursor_v1` 作为后台扫描进度，payload.kind 为 daily-scan-cursor；不匹配业务 daily-state 查询。每批仍最多 20 条，按 `_id` 向后分页，失败也记录游标推进，末尾下一轮从头补偿。进度写入失败则整批返回错误；已封存项目由 sealed 状态幂等跳过。该文档不包含业务内容或凭证，不清除失败项目的日结状态。

本地已验证首 20 个项目失败不会饿死后续健康项目，以及后续轮回恢复。此增量已在 2026-10-05 部署，管理员调用实际验证游标读写、范围查询和重复调用幂等，见 daily-cursor-cloud 报告；新版真实定时触发仍不能沿用旧包报告冒充。仍需单独完成先前待确认的客户端 invoke:false 规则，代码注释不代替权限。


## 19. 筹备日历与活动汇总

`activity.month` 传入 YYYY-MM，读取最多 31 个日汇总，使用服务器 Asia/Shanghai 当前日；须同网关其他动作携带项目凭证。`history.list` 可传 day=YYYY-MM-DD 和 nextCursor，只取该业务日的版本元数据。分类统计和活动总量仍在业务事务中写一次同一个日文档；普通编辑不创建版本。

legacy 文档只有 day/count 时按“历史未分类”呈现，继续写入时保留原数量。删除/清除归入原业务模块，回收恢复按原操作模块计 restored；整项目恢复只增加当日一条项目活动，不回滚日汇总。不改变旧回执保留策略。

月份接口当前顺序读取小文档，2026-10-05 一次真实客户端调用实测 1366 ms；后续做多项目/规模测量再决定是否需要月索引，不能凭猜测增加重复汇总或宣称容量达标。

`probe-daily-schedule.mjs <manifest> <fresh report> --invoke` 是明确的管理员调用验证模式，会新建虚构前日项目并调用两次 worker，核对游标和重复幂等；不带 --invoke 仍是等待真实调度，报告的 mode 必须区分。失败标记只包含 failedAt，不存原始 SDK 异常、凭证或日志正文。

## 18. 协作链接轮换隔离验收（2026-10-05）

`probe-access-flow.mjs <公开环境配置路径> <部署 manifest> <新的报告路径>` 使用匿名 Node JS SDK 对真实 gateway 验证管理权限、链接轮换、旧链接拒绝、原请求幂等、版本冲突。报告先独占创建，只在 `fusion-created-*` 新建一个虚构项目；秘密只在内存中，退出后不提供该临时项目的链接找回。失败保留阶段和项目 ID，不输出 SDK 原始错误或凭证。

本次 staging `/private/tmp/planner-access-20261005-a` 沿用原 UI 两个项目白名单，gateway 新包 SHA 为 `2052a7b9707af47598741c2d1c5263700a93d936b558cde0cebe1a228ac19f12`。从 staging 部署同名验证函数，等待 CLI 完成及 Active 读回后再调用脚本；不要因 COS 上传阶段长时间无新输出而重复部署。4 组真实云端通过，报告见 `docs/validation/2026-10-05-access-cloud.json`；尚非浏览器轮换/复制/重开 UI 证明。

## 19. 到期清理 Admin SDK 实际验证（2026-10-05）

运行 `node scripts/fusion/probe-retention-cloud.mjs <新的报告路径>`。固定开发验证环境、ADMINONLY 探针集合，通过 CLI 临时凭证操作；脚本只通过创建服务新建自己的虚构项目并把到期时间设为过去，不改变真实时间或其他项目。只清理自己生成的两条到期正文，保留报告和其余样本。成功报告为 `docs/validation/2026-10-05-retention-cloud-final.json`，不等同于部署定时维护函数。

实测陷阱：文档字段 `payload.expiresAt` 的条件也会命中历史索引数组中的元素；投影后的 `payload` 可能是数组。扫描必须使用 `retentionScanRow` 区分正文与索引，跳过索引但推进游标，不能把它当回收正文或清理失败。测试回收记录必须含有效 changes；只断言“抛错”不能证明删除回滚，必须确认已走到删除后的索引写失败注入点，再读回正文与索引。

## 并发、丢响应及旧草稿隔离验收

运行 `node --experimental-strip-types scripts/fusion/probe-concurrency-flow.mjs <公开环境配置路径> <gateway 部署 manifest> <新的报告路径>`。脚本先核对 Active 和原验证白名单，只通过创建服务新建一个 `fusion-created-*` 虚构项目，秘密仅在内存中。报告独占创建，失败仅保留阶段名，不输出原始异常或凭证；不要覆盖失败报告或在未确认进程结束时重复启动。

场景包括：两个请求竞争同一座位、两个宾客并发编辑、实际冲突后保留原草稿再提交新意图、云端执行成功后故意丢弃返回结果并通过原回执恢复、整项目恢复后的旧代次草稿拒绝重发。并发通过两个 transport 请求流发出，使用同一个匿名 SDK 登录，不能作为独立浏览器/匿名身份隔离证据。本地队列使用独立 fake-indexeddb；真实数据库与本机故障注入的证明范围分别记录。脚本不修改函数、权限或已有项目。

## 恢复类草稿导出只读验证

运行 `node --experimental-strip-types scripts/fusion/probe-recovery-export.mjs <公开环境配置路径> <gateway 部署 manifest> <新的报告路径>`。沿用同一 dev gateway 和白名单检查，仅新建一个虚构项目；不部署代码或修改权限。回收桌子前先排座，检查导出恢复后的桌/人关联；整项目恢复先保存含笔记的目标版本，再修改宾客和笔记，检查未提交草稿及成功丢响应后的导出。

关键断言是导出前后云端核心/笔记、回收材料、历史列表和原队列不变；明确执行后实际安排与导出目标一致。完整请求和临时凭证只在内存中，报告只含环境、阶段、项目 ID、通过状态及耗时。模拟离线阻止回执查询，实际网络请求由正常 SDK 执行；fake-indexeddb 不替代浏览器，单一 SDK 登录不证明独立身份隔离。失败报告保留，用新报告路径重试，先确认原进程已退出。

2026-10-07 成功结果见 `docs/validation/2026-10-07-recovery-export-cloud-bounded.json`，两组真实云端验证通过。该脚本现会在每阶段和每个 SDK 调用前持久记录状态/动作名，SDK 请求超过 30 秒报 SDK_REQUEST_TIMEOUT；超时并不证明服务端未执行，不自动重放或清理项目。CLI 读回仍使用现有 90 秒进程上限。不得把 RUNNING 或空报告当 PASS，先核对原进程句柄和最终报告再决定下一步。


## 独立匿名身份协作与撤权验收

运行 `node scripts/fusion/probe-independent-clients.mjs <公开环境配置路径> <gateway 部署 manifest> <新的报告路径>`。脚本只允许开发环境 `dev-d1gh3jw1gdf06af22` 和 `planner-fusion-gateway-probe`，先核对 Active、验证白名单及关闭事件上下文日志；不部署代码或修改环境权限。通过两个隔离 Node 子进程分别初始化 SDK、匿名登录，从 `getLoginState().user.uid` 在内存核对两个身份不同。不要只创建两个 transport 就声称独立登录。

公开配置经 IPC 传给子进程；临时项目秘密不写命令行或日志。只创建一个纯虚构项目并轮换它的协作凭证；报告不保存 uid、身份哈希、凭证或完整响应，只记录独立身份核验布尔值、项目 ID、阶段与结果。进程退出后临时链接不保留。

每个 IPC 请求上限 30 秒，阶段/结果及时落盘，不自动重试未知结果。失败报告不覆盖；确认原进程已退出后才使用新报告路径重试。2026-10-07 首次在 deployment-readback 失败，未创建项目；取得网络执行权限后，`docs/validation/2026-10-07-independent-clients-cloud-retry.json` 四组通过。测试证明独立身份对应的实际 gateway/数据库行为，不替代不同浏览器/设备 UI、独立网络、移动端或离线队列验收。


## 当前产品页面的开发环境预览

`node scripts/fusion/preview-fusion-cloud.mjs <公开环境配置路径>` 只启动监听 `127.0.0.1:4188` 的 Vite，限定开发环境，不创建/覆盖项目或部署权限。通过浏览器 `/fusion` 的正常入口创建纯虚构项目进行验收。区别于旧 `preview-core-ui.mjs`，本脚本不使用管理员 SDK 预置白名单项目，适用于已启用项目创建服务的 gateway。

验收徽标统计当前标签页累计 fetch/XHR 与 Supabase 标准域名 HTTP 写请求，计数不含秘密；统计仅随预览注入，生产源码不注入。可以证明执行路径的 HTTP 观测结果，不作为全部协议/自定义域名的审计。凭证仍由正常产品的创建 vault / sessionStorage 管理，不复制到报告。
