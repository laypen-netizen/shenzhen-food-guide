import type { Catalogue,Shop } from '../src/lib/schema.ts';

// 所有字段仅用于本地功能测试，不代表真实门店、榜单、评分或公开来源。
export function fixtureShop():Shop {
  const fact=(text:string)=>({text,sourceIds:['poi']});
  return {
    id:'fictional-a',slug:'fictional-a',name:'虚构测试门店A',aliases:['功能测试甲'],district:'福田',street:'模拟街道',
    address:fact('虚构测试地址（不用于出行）'),category:'粉面',cuisine:'测试菜系',summary:fact('仅用于本地验证，不是真实收录。'),
    dishes:[fact('虚构测试米粉')],reasons:[fact('验证推荐理由来源绑定。'),fact('验证详情页静态生成。')],cautions:[],scenes:['测试场景'],
    history:{scope:'specific-store',latestOpeningDate:'2006-12-31',precision:'year',continuation:'verified',description:'模拟历史依据，不代表真实经营历史。',sourceIds:['history'],brandDescription:null},
    operating:{status:'reported-open',asOf:'2026-09-01',sourceIds:['poi'],note:'模拟营业依据，仅本地测试。'},
    price:{cny:28,asOf:'2026-09-01',sourceIds:['poi']},hours:fact('模拟营业时间，不用于出行'),coordinates:{lon:114.07,lat:22.55,system:'GCJ-02',sourceIds:['poi']},
    ratings:[{platform:'高德地图',value:4,max:5,count:null,asOf:'2026-03-01',sourceIds:['rating']},{platform:'高德地图',value:4.2,max:5,count:null,asOf:'2026-06-01',sourceIds:['rating']},{platform:'高德地图',value:4.5,max:5,count:null,asOf:'2026-09-01',sourceIds:['rating']}],
    rankings:[{name:'高德扫街榜（模拟）·2025测试榜',edition:'2025',rank:null,scope:'虚构范围',asOf:'2026-09-01',sourceIds:['ranking'],annualCompositeScore:{value:4.64,year:2025,label:'全年综合分',rawDisplay:'4.64'}}],
    metrics:{repeat:{value:80,sourceIds:['repeat'],method:'模拟指标，无真实业务含义',period:'测试时期'},stability:{value:90,sourceIds:['rating'],method:'模拟指标，无真实业务含义',period:'测试时期'},value:{value:70,sourceIds:['value'],method:'模拟指标，无真实业务含义',period:'测试时期'}},
    repeatVisits:null,photos:[],checkedAt:'2026-10-02',testOnly:true,
  };
}
export function fixtureCatalogue():Catalogue {
  const a=fixtureShop(),b=fixtureShop();b.id=b.slug='fictional-b';b.name='虚构测试门店B';b.district='罗湖';b.category='糖水';b.price=null;b.coordinates=null;b.ratings=[];b.metrics={repeat:null,stability:null,value:null};
  return {version:1,updatedAt:'2026-10-02',policy:'amap-only',note:'全部为隔离测试，不能发布',shops:[a,b],pending:[],sources:['ranking','history','poi','rating','repeat','value'].map(kind=>({id:kind,kind:kind as Catalogue['sources'][number]['kind'],title:`虚构${kind}来源（测试）`,url:`https://www.amap.com/?fictional-test=${kind}`,publishedAt:null,accessedAt:'2026-10-02',statement:'模拟来源记录，并非经过真实访问的业务证据。'}))};
}
