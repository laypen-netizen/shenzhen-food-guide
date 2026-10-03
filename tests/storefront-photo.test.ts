import {test} from 'node:test';
import assert from 'node:assert/strict';
import {storefrontPhotoSchema,sourceSchema} from '../src/lib/schema.ts';
const photo={kind:'storefront',path:'/photos/test.webp',width:1200,height:800,thumbnail:{path:'/photos/test-small.webp',width:640,height:427},alt:'测试门店的真实招牌',sourceLabel:'商家公开门店页',sourceUrl:'https://merchant.example/shops/test',imageUrl:'https://merchant.example/images/test.jpg',author:null,permission:null,permissionVerified:false,collectedAt:'2026-10-03',photographedAt:null,reviewNote:'具体分店页地址与门店一致，照片中招牌与店名对应'};
test('门头图可以保留外部来源及未知作者许可，不伪造已授权',()=>{const value=storefrontPhotoSchema.parse(photo);assert.equal(value.sourceUrl,photo.sourceUrl);assert.equal(value.author,null);assert.equal(value.permissionVerified,false);});
test('高德App榜单截图裁图保留本地证据且不伪造原图地址',()=>{
  const value=storefrontPhotoSchema.parse({...photo,sourceLabel:'高德 App 榜单截图裁图',sourceUrl:'https://a.a-map.link/joOqTL039HU',imageUrl:null,captureRef:'research/evidence/parallel-nanshan-korean.png'});
  assert.equal(value.imageUrl,null);assert.equal(value.captureRef,'research/evidence/parallel-nanshan-korean.png');
});
test('声称已核验许可时必须附具体依据',()=>{assert.throws(()=>storefrontPhotoSchema.parse({...photo,permissionVerified:true}));});
test('照片必须声明门头实景且本地路径和尺寸有效',()=>{for(const patch of [{kind:'food'},{path:'/photos/../private.jpg'},{width:0},{imageUrl:'javascript:alert(1)'},{sourceUrl:'http://merchant.example/'}])assert.throws(()=>storefrontPhotoSchema.parse({...photo,...patch}));});
test('截图裁图缺证据、越界路径或非高德来源都会拒绝',()=>{
  assert.throws(()=>storefrontPhotoSchema.parse({...photo,imageUrl:null}));
  assert.throws(()=>storefrontPhotoSchema.parse({...photo,imageUrl:null,captureRef:'research/evidence/../private.png',sourceUrl:'https://a.a-map.link/joOqTL039HU'}));
  assert.throws(()=>storefrontPhotoSchema.parse({...photo,imageUrl:null,captureRef:'research/evidence/capture.png'}));
});
test('扩展照片来源不会放宽高德门店事实来源规则',()=>{assert.equal(sourceSchema.safeParse({id:'external',title:'外部店名',url:photo.sourceUrl,kind:'poi',publishedAt:null,accessedAt:'2026-10-03',statement:'不应成为门店事实源'}).success,false);});
