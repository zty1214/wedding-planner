# 同提交 CI 失败诊断

目标提交 b6dc15e0df43079848273db25181de2ae1378b54；验收分支已授权推送，未合并、部署。

- [远端 API 回读](ci-report.json)：完整check通过，test:e2e失败。确切失败断言未知；日志/产物下载需要登录。
- [本地首次失败](local-chromium151-first-failure.json)及[截图](local-chromium151-first-failure.png)：冻结原代码，Chromium151.0.7922.34，notes/publish失败；截图已有发布正文。原驱动只记录脱敏阶段，未保存具体异常，不能认定与远端同因。
- 后续三次正常流程重跑均通过，报告见local-chromium151-rerun-1/2/3.json。源码仅增加首行异常类型脱敏诊断，业务源码与固定提交一致；临时延迟探针已移除。此前同版本Headless Shell正常流程亦通过。
- 为区分时序与同步问题，在临时虚构夹具分别延迟命令回包、延迟笔记表单清理，均通过，未证明重复文本定位或同步卡住假设。没有据此修改业务或放宽断言。

GitHub日志登录待配合；本机Docker CLI存在但daemon未运行，未自行启动或变更系统配置。本地通过不替代失败CI，B05保持未关闭。

## 登录后远端取证及缓存修正

用户登录后可读取失败日志：`FAIL create-project`；下载产物ZIP SHA-256为 `f2b180d5f7d3d45c1dda09af002e8a038d179db70fd407026071489531ee709b`，与GitHub公布值一致。[远端报告](remote-first-failure.json)绑定b6dc15e，只运行到创建阶段；[失败截图](remote-first-failure.png)完全空白。打包中其他已有截图不能证明远端执行过对应用例。不保存下载授权URL或浏览器凭证。

真实页面权限对照：只允许自建TMPDIR写入的Node25夹具，原 `/private/tmp/planner-sol-s03-vite-4208` 不可写时HTML仍200，但Vite优化依赖失败、创建表单不可见；[修正前](cache-permission-before.json)。夹具改用 `join(tmpdir(), ...)` 后，相同权限条件下表单可见且无缓存权限错误；[修正后](cache-permission-after.json)。[诊断脚本](diagnostic-cache-permission.py)仅本机Node25/Playwright诊断，不纳入Node22标准CI命令，不连接云端；4208占用时退出，不接管已有服务。该对照证明硬编码目录可造成相同症状，CI原始记录没有被丢弃的Vite stderr，精确归因仍以修正后的Ubuntu CI复跑确认。

[修正后本机七组报告](cache-fix-local-e2e.json)通过：冻结6f3f691加最小夹具修正、Chromium151。没有业务src/server变化，192项完整check沿用上一阶段，另执行本阶段脚本语法/lint及差异检查。远端复跑尚待本阶段提交与推送，不将本地通过当作CI关单。
