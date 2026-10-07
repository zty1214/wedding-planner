# 主流程自动浏览器回归

2026-10-07；独立工作树业务基线 `709f2650882007446a6f266993870a1da960d4e9`。新增 runner 与本报告、同前缀脱敏产物；按主会话授权最小修改既有夹具，新增 S03_PORT（默认4192、1024–65535整数校验）及按端口隔离临时缓存目录。不修改业务源码、依赖清单或 CI。

## 运行

需要 Node 22.18+、现有项目依赖、Playwright 和已安装的 Chromium。在仓库根目录执行：

```sh
node --check scripts/fusion/main-flow-e2e-run.mjs
node scripts/fusion/main-flow-e2e-run.mjs
```

主会话已固定安装 playwright@1.62.1，`npm run test:e2e` 执行runner；CI安装Chromium后运行并上传脱敏产物。远端尚未执行。runner默认使用项目依赖。若项目尚未安装 Playwright，可明确指定已有模块和可执行文件。本机验证命令：

```sh
PLAYWRIGHT_MODULE_PATH=/Users/baojie/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs \
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/Users/baojie/Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell \
node scripts/fusion/main-flow-e2e-run.mjs
```

该模块为 bundled Playwright 1.62.1；指定的已安装 Chromium 为 149.0.7827.55。1.62.1 默认期待的 Chromium 1234/headless shell 尚未安装，因此本次显式复用已有 1228。没有下载或复制浏览器、云端凭证，也不连接用户浏览器 CDP。

准确启动入口由 runner 自动执行：

```sh
S03_PORT=4196 node --experimental-strip-types scripts/fusion/sol-s03-main-flow.mjs
```

不要另行启动该夹具后再运行 runner。runner 先检查 `127.0.0.1:4196` 可用，再启动自己的服务；端口占用返回 `PORT_4196_UNAVAILABLE` 和非零退出码，不接管或停止既有服务。结束时只停止自身创建的子进程。服务标准输出/错误不归档；启动失败报告分类代码。

## 隔离与断言

- 每次启动 MemoryStore 为空；浏览器为独立 Playwright Chromium，新 context 提供全新 IndexedDB/localStorage/sessionStorage。结束后关闭浏览器，不使用用户 profile。
- 真实 App、表单、Konva 与 IndexedDB 沿用原代码。夹具仅将网关替换为本机同源接口，`envDir:false` 不加载 `.env`。浏览器外部 HTTP 请求被拒绝。
- 创建虚构项目，实际点击复制协作链接并在内存读取剪贴板，随后通过正常链接加入；不修改业务存储来授予访问权限。链接不输出、不写报告或截图。
- 名单新增虚构甲/乙，电话 `00123456789` 保留前导零，确认住宿需求。
- 新建10人桌，用实际可见画布中心坐标选桌，编辑桌名并分配甲，验证已坐1人；不调用 Konva/React 内部状态或直接写 store。
- 同一标间 `001` 安排两人；甲住 `2026-12-31` 和 `2027-01-01`，乙仅住 `2027-01-01`。逐晚按钮 pressed 状态核对，日期过滤后当晚人数为1/2、房间数均为1。
- 发布酒店笔记，整页刷新，重新核对笔记正文、电话、桌名/座位数量、房号和个人晚次。
- 同 context 两标签页共享队列：断网新增丙，只读 IndexedDB 核对同一 operationId 与队列数量1；重连、刷新第二页、关闭第一页后，队列为0；正常 read API 核对服务端丙仅1个。
- 第二个独立 context 经协作链接读回个人晚次、新增丁；先由只读gateway确认丁/电话及该context队列为0，再在管理侧刷新核对丁和 `00012345678`；最终本机 gateway read 核对4宾客、1桌、1房、1笔记。独立 context 验证与同源共享队列分别记录。

操作等待有截止时间（控件15秒、条件20秒、翻月最多48次）；失败非零退出。可见 UI 断言与只读服务端/队列数量共同使用，不只依赖“已同步到云端”文案。这里的产品文案代表本机网关确认。

## 产物与安全

每次重跑先将既有报告及失败截图归档为带时间/进程后缀的文件，再写入 `docs/validation/main-flow-e2e-report.json`，包含基线 SHA、时间、浏览器版本、每阶段通过/失败、耗时、脱敏失败代码及实体数量。失败时另产出 `main-flow-e2e-failure.png`（不保存原始异常）。截图为同目录 `main-flow-e2e-{guests,seating,stay,notes,shared-queue,collaboration}.png`。截图仅捕获页面，不捕获浏览器地址栏；链接管理区域和密码字段遮罩。没有 trace、HAR、原始异常、全量 HTML、请求体、访问秘密或用户浏览器 storage 导出。

失败运行不表示此前四模块人工验收无效。最终集成后应重新运行并绑定最终 SHA；本机通过不代表真实云端、真机、远端 CI 或正式迁移/发布通过。主会话已完成固定依赖、npm命令及CI配置接线；同提交远端结果仍待补。

## 实际运行记录

- `node --check` 通过。
- 独立 Chromium 启动探针通过，版本149.0.7827.55。
- 首次尝试原4192端口发现已有服务，runner 未接管或停止；主会话随后授权端口参数，使用4196。最终完整运行七组通过，退出码0。详见同目录脱敏JSON；最终本机网关4宾客、1桌、1房、1笔记，snapshotRevision18。共享队列离线1项、重连0项，丙服务端仅1个。

报告SHA为业务基线；本阶段runner与端口参数仍为未提交改动，主会话将集成后绑定最终提交复验。开发中失败源于runner选择器与异步等待：画布先点击产品定位按钮再按可见中心选择；笔记刷新前按服务端确认正文；共享队列按Core字典契约读取。没有为绕过业务失败修改src/server或放宽人数/晚次断言。

- 端口占用自动负例通过：自建4196监听仍保持运行，runner退出码1、脱敏原因 `PORT_4196_UNAVAILABLE`；产物 `main-flow-e2e-port-collision.json`。随后恢复原完整成功报告，未将负例覆盖成功证据。
- `node --check` 两脚本、定向 Oxlint、非法 `S03_PORT=bad` 拒绝（退出1）均通过。六张成功截图已逐张检查，只有虚构姓名、电话和业务状态，没有链接秘密。已删除开发中旧失败截图，最终交付仅保留成功截图与端口负例JSON。
- 本任务不执行完整npm check；主会话负责最终集成回归、完整检查及相同提交远端CI。

主会话在main-flow-acceptance集成后使用项目内playwright及已有Chromium路径复验，七组再次通过，退出0。完整npm run check通过191项；未将本机结果视为远端CI。

## 远端自动化闭环（2026-10-07）

目标代码 `0bba82732fb0ecfe1187db0c3aba8b413a879157` 的[GitHub CI #2](https://github.com/zty1214/wedding-planner/actions/runs/37642290159) completed/success：锁文件安装、完整check、Chromium安装、七组实际浏览器和脱敏产物上传通过。B04自动化交付闭环；首轮b6dc15e空白页及系统临时目录修正见[B05](main-flow-b05-integration.md)。此结论仅覆盖真实App＋虚构本机网关，不替代B01云端或B03真机。
