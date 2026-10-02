import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateCatalogue } from './schema.ts';
import { buildRecommendations,compareRecommendations } from './recommendation.ts';

const testing = process.env.ALLOW_TEST_DATA === '1' && !process.env.CI;
if (process.env.DATASET_FILE && !testing) throw new Error('只有隔离的本地测试可替换数据集');
const path = testing && process.env.DATASET_FILE ? resolve(process.env.DATASET_FILE) : resolve('src/data/catalogue.json');
export const catalogue = validateCatalogue(JSON.parse(readFileSync(path,'utf8')), {allowTestData:testing,asOf:process.env.AS_OF});
export const recommendationById=buildRecommendations(catalogue.shops,catalogue.sources,catalogue.updatedAt);
export const shops = [...catalogue.shops].sort((a,b)=>compareRecommendations(a,b,recommendationById));
