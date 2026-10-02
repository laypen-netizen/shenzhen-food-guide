import { existsSync,readFileSync,readdirSync,statSync } from 'node:fs';
import { resolve,join } from 'node:path';
const base=`/${(process.env.BASE_PATH||'/').split('/').filter(Boolean).join('/')}`;
const prefix=base==='/' ? '/':`${base}/`;
const buildDirectory=resolve(process.env.BUILD_DIR || 'dist');
const errors:string[]=[];
function visit(dir:string) {
  for(const name of readdirSync(dir)) {
    const file=join(dir,name);if(statSync(file).isDirectory()) visit(file);
    else if(name.endsWith('.html')) {
      const html=readFileSync(file,'utf8');
      for(const [,attribute,url] of html.matchAll(/\b(href|src)="([^"#]+)"/g)) {
        if(!url.startsWith('/') || url.startsWith('//')) continue;
        const clean=url.split(/[?#]/)[0];
        if(!clean.startsWith(prefix)) { errors.push(`${file} ${attribute} 未包含 base: ${clean}`);continue; }
        const path=resolve(buildDirectory,clean.slice(prefix.length)||'index.html');
        if(!existsSync(path) && !existsSync(join(path,'index.html'))) errors.push(`${file} 本地资源不存在：${clean}`);
      }
      if(!html.includes('<html lang="zh-CN"')) errors.push(`${file} 缺页面语言`);
      if(!html.includes('rel="canonical"')) errors.push(`${file} 缺 canonical`);
    }
  }
}
for(const path of ['index.html','favorites/index.html','methodology/index.html','status/index.html','404.html','robots.txt','sitemap-index.xml']) if(!existsSync(join(buildDirectory,path))) errors.push(`缺少 ${path}`);
visit(buildDirectory);
if(errors.length) throw new Error(errors.join('\n'));
console.log(`静态资源、独立页面和 base 路径检查通过：${prefix}`);
