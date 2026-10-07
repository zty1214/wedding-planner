# 独立预发部署准备

2026-10-08。实现了独立业务入口与离线打包，未创建环境、下单、部署、迁移或改变现有线上配置。依据[计划](../2026-10-08-visual-migration-release-plan.md)R1，候选网址/环境、试用者和副本范围仍需确认。

## 入口与配置

现有probeFunction固定旧开发环境及两个探针项目，不能直接复制到预发。新增businessFunction复用共享gateway路由、领域命令、双链接鉴权、回执、历史及回收行为；不注册probe.increment/probe.manage，不接图片接口。原probeFunction/probeGateway保持开发探针能力和配置；未替换云端已部署包。

业务入口接纳标准fusion-created/fusion-migrated UUID项目；接纳ID不代表授权，必须有已存储access且secret匹配。未知ID不会自动创建，只有明确project.create才创建；创建幂等和每日全局限额沿用原机制。新入口不默认使用开发200，必须明确填写候选额度，正式策略另行决定。

| 服务端配置 | 要求 |
| --- | --- |
| FUSION_ENV_ID | 独立目标，禁止旧来源dev-d1gh3jw1gdf06af22 |
| FUSION_REGION | ap-shanghai |
| FUSION_COLLECTION_PREFIX | 独立planner_fusion_*前缀，禁止planner_fusion_probe；生成access/current/receipts/activity四集合 |
| FUSION_CREATION_DAILY_LIMIT | 明确正整数；预发可按密集验收需求配置200，正式值另定 |

businessRetentionFunction使用同一环境/集合及项目规则，沿用分页保留清理；只允许内部调用，客户端调用必须实际拒绝。每日定时业务快照函数不部署、不启用；图片上传继续延期。源码保护不能代替云端函数调用权限。

## 离线包

```sh
node --experimental-strip-types scripts/release/build-business-functions.mjs --output /CONTROLLED/fresh-package --target-env CONFIRMED_PREPROD_ENV --region ap-shanghai --collection-prefix planner_fusion_preprod --creation-limit 200
```

输出必须是仓库外全新目录。生成gateway/retention两个CommonJS包，handler为index.main，SDK锁定3.18.3；manifest绑定当前Git基线、实际server/src/fusion源码树哈希、目标配置与包内容哈希。Git基线不冒充未提交源码的候选SHA，发布时还需补固定候选提交及实际配置回读。工具只打包，不部署；无runtime默认值；当前来源函数实际回读为Nodejs20.19、256MB、20秒、index.main，三个事件日志开关均false，开发额度200。目标需逐项核对平台支持和活跃配置。

## 部署前和部署后核对

1. 独立环境账号资格、最终报价及预算、续费策略确认；目录UnitPrice不当成交付订单。新环境不共享来源库或密钥。
2. 前端使用候选环境ID、新Publishable Key和新业务函数；禁用所有本地故障/探针控制入口，来源域名按候选网址配置。匿名鉴权方式、运行时、内存/超时、资源限额、日志策略与当前配置逐项回读，记录必要差异。
3. 四业务集合直接客户端读写均拒绝；业务网关开放指定鉴权入口，retention客户端调用拒绝，关闭事件入参日志。不要把访问链接秘密写进配置清单。
4. 记录前端候选SHA、网关bundle hash、SDK、schema2、迁移批次和配置摘要；部署后回读实际活跃包及配置，不能只看上传成功。
5. 在独立虚构/试迁项目验证直接数据库拒绝、跨项目及双链接权限、两端编辑、手机操作、断网草稿、历史/回收和导出。目标试迁projectId须使用fusion-migrated-UUID或合法fusion-created-UUID，CLI的显式projectId本身不验证最终业务入口可达性。
6. 明确链接保管/受控找回、灾难备份策略、试用者与副本范围后受控交付。正式停写/切换和观察验收另用执行单。

测试入口和证据见[来源备份](../validation/source-backup-20261008/README.md)及[预发工程](../validation/preproduction-engineering-20261008/README.md)。本机SDK传输替换、打包烟测及浏览器夹具都不代表目标云端已验证。

最新创建调查见[进度记录](2026-10-08-implementation-progress.md)：免费体验版创建被CreateDealError拒绝，未确认新环境；个人版首月实际报价19.90元，预算待确认。官方[CreateEnv](https://cloud.tencent.com/document/api/876/128592)明确会自动下单支付，别名最长20位，手动续费与超限停用参数需显式固定；不把免费询价等同可发货。

## 独立前端入口与离线候选构建

预发候选必须使用Fusion-only构建：首页进入`/fusion`，旧`/guests`、`/seating`、`/stay`、`/notes`及旧分享路径返回项目入口，不把旧ID转换为新凭证。新Fusion深链保留原权限校验。默认开发/旧站构建仍沿用现有路由。

离线构建命令（值为示例，不能直接部署）：

```sh
node scripts/release/build-business-frontend.mjs \
  --output /受控目录/全新候选目录 \
  --target-env 独立目标环境ID \
  --publishable-key 目标公开访问密钥 \
  --function planner-fusion-gateway
```

只接受独立环境和明确非probe函数；产物目录必须在Git外且不存在。工具不读`.env`，显式覆盖继承的VITE配置，禁用Supabase客户端。manifest绑定基线SHA、实际源码/配置/产物哈希；配置摘要不代替部署配置回读。公开访问密钥属于浏览器配置，禁止把服务端凭证传入此参数。

`npm run test:e2e:business`使用生产构建和虚构配置，检查首页/旧路径、新深链保留、错误环境/probe拒绝、继承旧配置未进入产物及零外部请求。远端CI执行此检查；真实网关、域名、直接数据库拒绝及手机验收仍须在独立环境补齐。此工具不创建资源或发布站点。
