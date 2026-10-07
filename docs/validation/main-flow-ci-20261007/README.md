# 同提交 CI 失败诊断

目标提交 b6dc15e0df43079848273db25181de2ae1378b54；验收分支已授权推送，未合并、部署。

- [远端 API 回读](ci-report.json)：完整check通过，test:e2e失败。确切失败断言未知；日志/产物下载需要登录。
- [本地首次失败](local-chromium151-first-failure.json)及[截图](local-chromium151-first-failure.png)：冻结原代码，Chromium151.0.7922.34，notes/publish失败；截图已有发布正文。原驱动只记录脱敏阶段，未保存具体异常，不能认定与远端同因。
- 后续三次正常流程重跑均通过，报告见local-chromium151-rerun-1/2/3.json。源码仅增加首行异常类型脱敏诊断，业务源码与固定提交一致；临时延迟探针已移除。此前同版本Headless Shell正常流程亦通过。
- 为区分时序与同步问题，在临时虚构夹具分别延迟命令回包、延迟笔记表单清理，均通过，未证明重复文本定位或同步卡住假设。没有据此修改业务或放宽断言。

GitHub日志登录待配合；本机Docker CLI存在但daemon未运行，未自行启动或变更系统配置。本地通过不替代失败CI，B05保持未关闭。
