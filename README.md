# 深圳美食指南

Astro + TypeScript 静态网站。门店内容只接受高德来源，正式收录要求可核验的扫街榜记录、具体门店资料与近期营业线索；店龄是可选背景，不是收录门槛。综合评分：满意度30%、重复到店30%、稳定性25%、性价比15%；缺指标不虚构分数。

收录不设各区数量配额，优先整理多项高德依据相互支持的商家。默认“综合参考优先”先展示编辑优选组，依据原始评分、评价数量、近180天回头客人数及原范围的上榜记录，逐店公开理由。编辑优选组内按地区、店名排列；其余有2025原榜全年综合分的门店按原值降序、同分按店名展示，缺分记录仍保留，不表示质量较差。评价数是样本量线索，回头客人数受规模影响，不直接变成质量分。阅读顺序不代表跨品类官方排名；四维100分仅在口径与数据满足要求后计算。

门店与候选数量以 `src/data/catalogue.json` 为准。资料通过高德 App 截图、官方2025榜单网页及对应门店详情整理；“十年老店”等筛选路径会作为来源上下文保留，但不再限制收录。Top 100 指本站整理的100家选集，不是高德官方深圳总排名。网页的2025“全年综合分”单独注明年份，不充当当前用户评分或本站四维综合分。公开 POI API 与官方 MCP/CLI 不能直接证明门店上榜；调查见 [接口记录](research/api-notes.md)和[公开网页通道](research/public-ranking-channel.md)。

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
- 指标与缺项计算：`src/lib/scoring.ts`。
- 编辑优选及证据快照：`src/lib/selection.ts`。数据变化后旧理由自动失效，正式构建会要求复核；不靠固定地区名额或评价数单指标决定优选。
- 店龄资料可缺省；有可靠依据时只记录具体分店历史，不从品牌年龄、平台收录年限或“老字号”标签推断。
- 营业依据日期与访问日期分开保存，超过维护期限重新核验。
- 图片只使用有明确使用权的本地实拍，路径置于 `public/photos/`；无授权照片保持占位。
- 底图为 OpenStreetMap，店铺数据与坐标只接受高德；GCJ-02在地图展示时转为WGS-84，导航保留GCJ-02。底图不参与内容评分。
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

已读取的深圳扫街榜门店、评分、参考人均和榜单记录见 `src/data/catalogue.json`。`sources.capture` 保存观察路径与本地截图位置；高德搜索链接只用于找到门店，不冒充榜单分享链接。截图保存在本地 `research/evidence/`，包含平台图片，仅作核验，不打包至网站或默认上传。导航里程、全年热度、本地人推荐人数、“收录年限”各自保留含义，不推算回头率或开业年限。高德页面明确披露的近180天回头客人数可以原值展示，但在缺少分母或同口径样本时不直接换算为回头率或综合评分。

`scripts/collect-amap-mirror.mjs` 与原生点击、滚动助手是实验性采集工具。输入调用成功不能证明手机界面已响应，必须逐次回读；误入分享页、遇验证码或镜像断开时停止。默认不发送输入，未验证通过的截图不自动转为正式数据。
