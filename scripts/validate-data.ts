import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateCatalogue } from '../src/lib/schema.ts';

const allowTestData = process.env.ALLOW_TEST_DATA === '1' && !process.env.CI;
if (process.env.DATASET_FILE && !allowTestData) throw new Error('禁止在正式构建替换数据集');
const data = validateCatalogue(JSON.parse(readFileSync(process.env.DATASET_FILE || 'src/data/catalogue.json','utf8')), {allowTestData,asOf:process.env.AS_OF});
for (const shop of data.shops) for (const photo of shop.photos) {
  for (const path of [photo.path,photo.thumbnail.path]) if (!existsSync(resolve('public',`.${path}`))) throw new Error(`照片不存在：${path}`);
  if (photo.captureRef && !existsSync(resolve(photo.captureRef))) throw new Error(`门头截图证据不存在：${photo.captureRef}`);
}
console.log(`数据校验通过：${data.shops.length} 家正式门店，${data.pending.length} 家待核验，${data.sources.length} 条高德来源。`);
if (!data.shops.length) console.log(data.pending.length ? '内容状态：已有真实高德候选；尚无通过门店地址、榜单及营业依据核验的正式收录。':'内容状态：真实扫街榜数据待接入；没有正式门店，构建通过不代表内容采集完成。');
