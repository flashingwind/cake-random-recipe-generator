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
test('volume leaves unsupported cells empty and never hatches across methods',()=>{
 const {buildVolume}=require('../region-grid.js');
 const model=prepare([row('a1','A',10,'foam'),row('a2','A',20,'foam'),row('b1','B',10,'separate'),row('b2','B',20,'separate')]);
 const volume=buildVolume(model,[{...row('a','A',10),name:'A'},{...row('b','B',10),name:'B'}],{fat:100,egg:200,liquid:40},[10,21,21]);
 assert.ok(volume.cells>0);assert.ok(volume.cells<volume.totalCells);assert.ok(volume.faces.length>0);
 assert.ok(volume.faces.every(f=>f.categories.length===1));
 assert.ok(volume.faces.every(f=>f.vertices.every(v=>v.every(n=>n>=-1&&n<=1))));
});

test('2D projection ignores water while 3D retains its distance',()=>{
 const rows=[row('a','A',10),row('b','A',20)];
 const projection=prepare(rows,['fat','egg']);const spatial=prepare(rows);
 const point=row('p','A',10),wet={...point,liquid:1000};
 assert.deepEqual(inspect(projection,point,'foam'),inspect(projection,wet,'foam'));
 assert.equal(inspect(projection,wet,'foam').type,'supported');
 assert.equal(inspect(spatial,wet,'foam').type,'insufficient');
});

test('projection is the union of actual 3D voxels along water, not a new 2D classifier',()=>{
 const {projectVolume}=require('../region-grid.js');
 const group=(category,method)=>({category,method,color:'#123456'});
 const volume={resolution:[2,2,3],voxels:[
  {indices:[0,0,0],categories:[group('A','foam')],profiles:['standard']},
  {indices:[0,0,2],categories:[group('B','foam')],profiles:['home']},
  {indices:[0,0,1],categories:[group('C','separate')],profiles:['home']}
 ]};
 const projection=projectVolume(volume,{fat:100,egg:200,liquid:300});
 const point={fat:25,egg:50};
 const foam=projection.inspect(point,'foam');
 assert.equal(foam.type,'conflict');assert.deepEqual(foam.categories.map(g=>g.category),['A','B']);
 assert.equal(projection.inspect(point,'separate').type,'supported');
 assert.equal(projection.inspect(point,'mix').type,'other-method');
 assert.equal(projection.inspect({fat:75,egg:150},'foam').type,'insufficient');
 assert.deepEqual(projection.inspect({...point,liquid:0},'foam'),projection.inspect({...point,liquid:300},'foam'));
});
