import {writeFileSync} from 'node:fs';
import {fixtureCatalogue} from '../tests/fixtures.ts';
writeFileSync('tests/generated-catalogue.json',JSON.stringify(fixtureCatalogue(),null,2));
console.log('隔离测试数据已写入 tests/generated-catalogue.json，不得放入正式数据目录。');
