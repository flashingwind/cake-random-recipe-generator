const test=require('node:test'),assert=require('node:assert/strict');
const {prepare,inspect}=require('../region-grid.js');
const row=(id,category,fat,method='foam',kind='public-recipe')=>({id,category,fat,egg:100,sugar:100,liquid:20,bp:0,color:category==='A'?'#4a7fb5':'#8a5fb0',method,kind});
test('anchors cannot establish data support',()=>{
 const model=prepare([row('a','A',0),row('b','A',10),row('anchor','B',100,'cream','anchor-estimate')]);
 assert.equal(model.rows.length,2);assert.equal(inspect(model,row('p','A',100),'cream').type,'insufficient');
});
test('nearby contradictory labels produce a conflict with both categories',()=>{
 const model=prepare([row('a','A',10),row('b','B',10),row('c','A',0),row('d','B',20)]);
 const result=inspect(model,row('p','A',10),'foam');
 assert.equal(result.type,'conflict');assert.equal(result.categories.length,2);
 assert.deepEqual(new Set(result.categories.map(r=>r.category)),new Set(['A','B']));
});
test('same category support, other method, and distant unsupported points are distinct',()=>{
 const model=prepare([row('a','A',10),row('b','A',20)]);
 assert.equal(inspect(model,row('p','A',10),'foam').type,'supported');
 assert.equal(inspect(model,row('p','A',10),'cream').type,'other-method');
 assert.equal(inspect(model,row('p','A',1000),'foam').type,'insufficient');
});
test('projected overlap alone does not establish three-feature support',()=>{
 const model=prepare([row('a','A',10),row('b','A',20)]);
 assert.equal(inspect(model,{...row('p','A',10),liquid:500},'foam').type,'insufficient');
});

test('overlap across methods never produces stripes',()=>{
 const model=prepare([row('a','A',10,'foam'),row('b','B',10,'separate'),row('c','A',0,'foam'),row('d','B',20,'separate')]);
 for(const method of ['foam','separate','mix']){
   const result=inspect(model,row('p','A',10),method);
   assert.notEqual(result.type,'conflict');
   assert.equal(result.categories.length,1);
 }
});
test('sugar and BP cannot move region boundaries',()=>{
 const model=prepare([row('a','A',10),row('b','B',20)]);
 const point=row('p','A',11);
 assert.deepEqual(inspect(model,point,'foam'),inspect(model,{...point,sugar:200,bp:8},'foam'));
});
