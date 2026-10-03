# 深圳美食指南

Astro + TypeScript 静态网站。门店内容只接受高德来源，正式收录要求可核验的扫街榜记录、具体门店资料与近期营业线索；店龄是可选背景，不是收录门槛。高德提供原始榜单、门店资料和评分，本站负责具体分店去重、来源整理与缺口说明。

收录不设总数上限或各区数量配额。网站原样展示高德门店评分、评价数、依据日期和来源，不换算、不加权，也不计算本站综合分。默认按评分值降序；同分时按行政区、店名和稳定 ID 排列，只为保持浏览顺序稳定。缺少高德评分时保存为 `null` 并显示“暂无评分”，不会补成0。回访人数可选展示，不影响评分或排序。当前数量与原始资料日期以站点状态页和评分快照为准。

门店与候选数量以 `src/data/catalogue.json` 为准。资料通过高德 App 截图与官方分享入口、官方公开榜单网页及对应门店详情整理；“十年老店”等筛选路径会作为来源上下文保留，但不再限制收录。榜单届次、原始范围和字段保留在来源明细中，前台使用统一目录，不按年份拆榜。只有具体分店的来源明确记录 `edition=2025` 或 `edition=2026` 时才显示对应上榜年标签；采集日期或页面观察年份不能充当届次。年份标签独立于高德评分，不加分，也不影响排序。原榜名次、“全年热度值”和“全年综合分”等信息只用于收录及回查，也不会因一家店出现在多个榜单而重复计算。公开 POI API 与官方 MCP/CLI 不能单独证明门店上榜；调查见 [接口记录](research/api-notes.md)和[公开网页通道](research/public-ranking-channel.md)。

## 高德评分与排序

每家门店的评分记录包含高德显示值、评价数、依据日期和来源 ID。`max=null` 表示来源没有向本站披露可核验的量表上限；代码和页面不能因此假设满分是5分，也不能把4.8换算成96分、好评率或星级。评价数只作为记录背景展示，不参与加权。

App 与 PC 来源分别保存。当前没有证据证明两个通道的量表、更新节奏和统计口径已经校准，因此不对通道加成、不取平均，也不建立跨渠道综合模型。用户仍可按记录值浏览当前目录，但该顺序不能称为“高德官方总榜”或全深圳餐厅质量排名。

回访人数、榜单名次、年份标签、资料完整度和重复上榜次数都不影响评分或排序。评分与评价数不能识别刷评；没有去重到店总人数、容量、营业时长和曝光量等分母，也不能从回访人数推算回头率。资料更新后顺序可能变化，只表示本站记录发生变化，不足以证明餐厅表现提高或下降。

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
- 评分读取与排序：`src/lib/catalogue.ts` 导出 `ratingById` 和按高德记录评分排列的 `shops`。评分缺失时为 `null`；同分按行政区、店名和稳定 ID 排列。原始评分快照保留评分、评价数、日期和来源，不生成本站综合分。
- 评分展示与默认排序：`src/lib/amap-rating.ts`。保留最新的高德原始记录，同日评价数口径冲突时如实提示；不再使用编辑精选或本站计算的参考分。
- 店龄资料可缺省；有可靠依据时只记录具体分店历史，不从品牌年龄、平台收录年限或“老字号”标签推断。
- 营业依据日期与访问日期分开保存，超过维护期限重新核验。
- 门头图使用具体分店的真实招牌或入口照片，保存在 `public/photos/` 并生成小图/大图；来源可扩展到商家官方及公开图片资料，门店事实仍只接受高德。记录原始页面、原图地址、采集日期和实际可得的作者/许可信息；未知保持 null，不能把可下载写成已授权。本站为个人学习研究的非商业网站。首页主题插画不作为门店实拍。
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

不同榜单的明确届次、范围和原始字段各自保留。统一目录不按年份拆榜；具体分店只有在来源明确记录 `edition=2025` 或 `edition=2026` 时才显示对应标签，采集日期或页面观察年份不能充当届次。原榜名次、“全年热度值”和“全年综合分”只作收录与回查依据。截图筛选显示“附近”时，只保存当前 App 范围和页面名次。导航里程、本地人推荐人数、“收录年限”和回访人数各自保留原义，不影响评分或排序，也不推算回头率、真实客流或开业年限。

下一步资料改进优先级为：可回查的评分与评价数、可去重的到店人数、回访分母、星级分布和连续观察快照。这些字段目前尚未全部取得，也未承诺自动采集；取得后仍需先确认定义、来源通道与日期口径。补充字段不会自动进入评分或排序。

`scripts/collect-amap-mirror.mjs` 与原生点击、滚动助手是实验性采集工具。输入调用成功不能证明手机界面已响应，必须逐次回读；误入分享页、遇验证码或镜像断开时停止。默认不发送输入，未验证通过的截图不自动转为正式数据。
