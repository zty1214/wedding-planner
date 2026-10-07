# 独立前端候选工程验收

2026-10-08，基线42697a4加本阶段工作区。增加显式Fusion-only路由和旧Supabase禁用，独立环境离线构建不读.env且覆盖继承配置。生产构建虚构配置检查七种首页/旧路径进入Fusion项目页、新Fusion深链保留、拒绝旧来源环境/probe函数、旧数据库配置不进入产物和零外部请求。

此验证使用隔离Chromium和本机静态站点，无真实云端或数据。默认模式业务浏览器回归与完整检查另附；不代表站点已部署或真机验收通过。同提交CI成功后再集成。

完整npm run check通过240项回归、规模/类型/lint及两次构建；七组默认模式主流程浏览器回归全部通过，见check.txt与main-flow-e2e.txt。独立生产构建浏览器检查通过，未调用云端。

候选cb2b99d同提交CI全部成功并已集成主feat，见[运行记录](https://github.com/zty1214/wedding-planner/actions/runs/37671694874)和ci-report.json。
