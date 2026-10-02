# 深圳美食指南

Astro + TypeScript 静态网站。门店内容只接受高德来源，正式收录要求可核验的扫街榜记录、具体门店资料与近期营业线索；店龄是可选背景，不是收录门槛。高德提供原始榜单和门店资料，本站负责具体分店去重、统一比较与缺口说明。

收录不设总数上限或各区数量配额。每次构建对全部门店重新核算参评资格，但“全部重算”不等于“全部评分”：具备同口径、非近似双证据的门店生成参考分区间、名次区间和 Pareto 层级；缺少回访或只有近似回访展示的门店继续收录，不生成区间。当前数量与原始资料日期以站点状态页和计算快照为准。行政区、预算和品类筛选只用于找店，不会在筛选后重新计算区间或层级。v4 比较方法更新于 `2026-10-03`；方法更新不表示重新采集了门店资料。

门店与候选数量以 `src/data/catalogue.json` 为准。资料通过高德 App 截图与官方分享入口、官方公开榜单网页及对应门店详情整理；“十年老店”等筛选路径会作为来源上下文保留，但不再限制收录。榜单年份、届次、原始范围和字段保留在来源明细中，前台不按年份拆榜。原榜名次、“全年热度值”和“全年综合分”等信息只用于收录及回查，不参与参考分，也不会因一家店出现在多个榜单而重复计分。公开 POI API 与官方 MCP/CLI 不能单独证明门店上榜；调查见 [接口记录](research/api-notes.md)和[公开网页通道](research/public-ranking-channel.md)。

## 参考分区间与 Pareto 分层

模型版本为 `partial-order-v4`。它只使用高德展示评分与近180天非近似回头客人数，不设置维度权重，也不把两个不同单位的字段相加或换算。标记为近似的“6.1万”等人数保留原文和来源，但不把存储值当作精确人数参与比较，也不补足最小比较样本。评价数只用于确认评分记录为正数，不加分、不缩放样本，也不参与高德原始平均分计算。

联合组要求评分采集通道、满分量表标记和观察日相同，同时要求回访字段通道、统计窗口和观察日相同；评分与回访的观察日也必须一致。观察不得晚于资料日期且需在最近180天内。每组至少10家，多个合格组先选样本量最大者，平局再依次选择观察日较近、固定组键较小者。10家门槛和最大组选择是本站公开的编辑规则，用于避免极小样本和混合口径，不是统计显著性、随机抽样代表性或全深圳覆盖的证明。其他组继续保留收录与来源；组选择以后发生变化，也不表示门店表现变好或变差。

同组每家门店与其余 `N - 1` 家逐一比较，并将关系完整分为四类：

- `L`：本店评分和回访人数都不低于对方，且至少一项更高，即本店严格领先。
- `D`：对方两项都不低于本店，且至少一项更高，即本店被严格领先。
- `C`：一项较高、另一项较低，属于交叉不可比，不强判任何一方领先。
- `E`：两项展示值完全相同。双同值在分数依据中计半，但不会被解释成质量相同。

旧版把交叉不可比关系压成一个单点整数，可能让结构不同的门店显示同分，掩盖无法确定的先后。v4 改为保留所有符合严格 Pareto 关系的可能顺序。精确计算依据写入 `scoreBasis`：

```text
lowerNumerator = 2L + E
upperNumerator = 2(L + C) + E
denominator = 2(N - 1)

scoreRange.lower = 100 × lowerNumerator / denominator
scoreRange.upper = 100 × upperNumerator / denominator

rankRange.best  = D + 1
rankRange.worst = N - L - E
```

`scoreRange` 是交叉门店全部排在本店之前或之后时的参考分上下界，同值组采用所占位置的平均名次；`rankRange` 是在保留同值并列组、满足全部严格支配关系的完整顺序中，本店可能取得的最好与最差竞争名次。区间不是统计置信区间、概率、好评率、真实受欢迎程度或唯一名次。页面使用精确分子分母向外取整：下界向下取整、上界向上取整，保证显示区间覆盖精确值；显示整数不参与排序，也不会反向改变关系计算。

`tier` 采用逐层非支配分层：第1层是在当前参评组中没有被任何门店双项领先的门店；移除第1层后再取下一组非支配门店，依次形成后续层级。同层不分先后，也不表示质量相同；跨层同样不代表每一对门店都能直接比较。列表只按 `tier` 升序组织，层内按行政区、店名和稳定 ID 排列，`scoreRange`、`rankRange` 及其显示整数都不用于排序。

本站沿用高德显示的原始评分，不推断5分制，也不把平均分解释成好评率；没有星级分布或好评人数时不能使用 Wilson 区间。模型不再生成旧版单点 `score`、整数并列名次或 `behaviorCeiling`。区间和分层仍不能识别刷评，高德评分与回头客人数也未必独立，平台未向本站提供反作弊保证。回头客人数缺少独立访客或到店总人数分母，不能换算成回头率。商圈体量、开店时长和采集对象选择偏差仍然存在。

## 本地运行

需要 Node.js 24或以上。

```sh
npm ci
npm run dev
```

浏览器打开终端显示的本地地址。检查与生产构建：

```sh
npm test
npm run check
npm run build
npm run verify:static
npm run preview
```

## GitHub Pages

本地根路径构建默认 site 为占位域名 `https://example.github.io`，公开发布前必须设置真实地址：

```sh
SITE_URL=https://YOUR_ACCOUNT.github.io BASE_PATH=/shenzhen-food-guide/ PUBLIC_REPO_URL=https://github.com/YOUR_ACCOUNT/shenzhen-food-guide npm run build
BASE_PATH=/shenzhen-food-guide/ npm run verify:static
BASE_PATH=/shenzhen-food-guide/ npm run preview
```

用户根站点仓库 `YOUR_ACCOUNT.github.io` 使用 `BASE_PATH=/`。环境变量通过命令或宿主环境传入；`.env.example` 仅为字段说明，不会自动生效。

仓库默认分支设为 `main`，Settings → Pages → Source 选择 GitHub Actions。工作流测试、检查、校验成功后发布 `dist/`，从仓库名自动识别根路径或项目子路径；其他分支的 PR 仅构建。自定义域名需要同步修改 `SITE_URL` 并另行配置 DNS/CNAME。

发布仓库：[laypen-netizen/shenzhen-food-guide](https://github.com/laypen-netizen/shenzhen-food-guide)。网站地址：[深圳美食指南](https://laypen-netizen.github.io/shenzhen-food-guide/)。推送到 main 后由 GitHub Actions 校验并发布，最新部署结果以仓库 Actions 和线上页面为准。纠错入口使用预填 GitHub Issue，访客自行提交。

## 数据维护

- 正式内容：`src/data/catalogue.json`。
- Schema/收录门槛：`src/lib/schema.ts`；关键事实按 `sourceIds` 绑定官方依据。
- 双证据区间、Pareto 分层、联合组选择与缺项计算：`src/lib/recommendation.ts`。模型使用满足本站同组规则的高德展示评分与近180天非近似回头客人数，输出精确 `scoreBasis`、`scoreRange`、`rankRange` 和 `tier`；不设置维度权重，不按评价数量加分，不把原榜指标重复计入。
- 编辑理由及证据快照：`src/lib/selection.ts`。数据变化后旧理由自动失效，正式构建会要求复核；不靠固定地区名额或单一指标决定顺序。
- 店龄资料可缺省；有可靠依据时只记录具体分店历史，不从品牌年龄、平台收录年限或“老字号”标签推断。
- 营业依据日期与访问日期分开保存，超过维护期限重新核验。
- 图片只使用有明确使用权的本地实拍，路径置于 `public/photos/`；无授权照片保持紧凑占位，并链接到高德官方门店页（只有搜索链接的明确标注先找店）。
- 底图采用 CARTO 的 OpenStreetMap 图层，保留双方署名；店铺数据与坐标只接受高德；GCJ-02在地图展示时转为WGS-84，导航保留GCJ-02。底图不参与内容评分。
- 停业或基础门店资料未确认的记录移入 `pending`，不直接显示为正式推荐。

在高德榜单真实来源取得后，先保存榜名、届次、范围、来源 URL 和核验日期，再匹配具体 POI。单独的 POI 评分或搜索排序不能证明榜单归属；评论中“常来”、导航里程和本地人推荐人数也不能代替高德明确披露的回头客人数。

批量整理时准备含 `sources`、`shops`、`pending` 数组的 JSON；可选提供 `updatedAt` 和 `note`。导入器默认只校验预览，遇到同 ID 不同内容或 slug 冲突会拒绝，不会覆盖已有记录；同 ID 的 pending 可由正式门店升级，已有来源继续保留：

```sh
node scripts/import-amap-batch.ts research/batch.json
node scripts/import-amap-batch.ts research/batch.json --write
```

`--write` 只更新本地 `src/data/catalogue.json`，不上传或外发。并行整理期间若文件被其他任务修改，写入会取消并要求重新运行。

已有授权 Web 服务 Key 时，可在本机环境设置 `AMAP_WEB_SERVICE_KEY`，仅用于补充**已经确认上榜**的门店：

```sh
node scripts/fetch-amap-poi.ts --keyword "已确认上榜的门店名称"
```

采集器一次请求最多25条候选，不抓取全城、不绕过限制；输出本地候选文件，不直接写入正式数据。不会默认下载或授权使用返回的照片，不推断评分量表，也不生成回头客数据。不要在聊天、Git、`PUBLIC_` 变量或网页内放 Key。

## 隔离的交互验证

测试数据明确为虚构，不用于真实推荐，默认校验拒绝发布。仅在非 CI 的本机启用，输出到 `.verification/fixture-dist`，不会覆盖生产 `dist/`：

```sh
node scripts/make-test-catalogue.ts
ALLOW_TEST_DATA=1 DATASET_FILE=tests/generated-catalogue.json AS_OF=2026-10-02 BASE_PATH=/shenzhen-food-guide/ npm run build
ALLOW_TEST_DATA=1 BASE_PATH=/shenzhen-food-guide/ npm run preview -- --port 4322
```

测试预览用于搜索、收藏、导入导出、详情、地图和子路径验证。CI禁用样例数据入口，Pages只上传生产 `dist/`。

## App界面采集

已读取的深圳扫街榜门店、评分、参考人均和榜单记录见 `src/data/catalogue.json`。可直接打开[必吃美食](https://a.a-map.link/famfHI1n584)、[回头客 · 全部美食](https://a.a-map.link/joOqTL039HU)和[本地人 · 全部美食](https://a.a-map.link/9QuUXci1petb)三个高德 App 官方分享入口。`sources.capture` 保存观察路径与本地截图位置；高德搜索链接只用于找到门店，不冒充榜单分享链接。截图保存在本地 `research/evidence/`，包含平台图片，仅作核验，不打包至网站或默认上传。

不同榜单的年份、届次、范围和原始字段各自保留。原榜名次、“全年热度值”和“全年综合分”不参与本站双证据参考区间，只作收录与回查依据。截图筛选显示“附近”时，只保存当前 App 范围和页面名次。导航里程、本地人推荐人数和“收录年限”各自保留含义，不推算回头率、真实客流或开业年限。高德明确披露的近180天回头客人数只有在来源通道、窗口、日期符合联合组规则且不是近似展示时才参与比较。

下一步资料改进优先级为：同一180天窗口内可去重的到店人数、回访分母、星级分布和连续观察快照。这些字段目前尚未取得，也未承诺自动采集；取得后仍需先确认定义、来源通道与日期口径。

`scripts/collect-amap-mirror.mjs` 与原生点击、滚动助手是实验性采集工具。输入调用成功不能证明手机界面已响应，必须逐次回读；误入分享页、遇验证码或镜像断开时停止。默认不发送输入，未验证通过的截图不自动转为正式数据。
