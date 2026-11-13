const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {predict,buildVolume,insideDomain,projectVolume}=require('../svm-regions.js');
const context={};vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../data/svm-field.js'),'utf8'),context);
const field=context.SVM_FIELD;
const anchors=vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8').match(/const ANCHORS = (\[[\s\S]*?\n\]);/)[0]+'; ANCHORS');
const focus=['パウンドケーキ','シフォンケーキ','ジェノワーズ'];
test('SVM final training includes all observed recipes and all 17 anchors; evaluation excludes anchors',()=>{
 assert.equal(field.summary.publicRecipes,179);assert.equal(field.summary.anchorEstimates,17);assert.equal(field.summary.trainingTotal,196);
 assert.equal(field.summary.anchorIds.length,17);assert.equal(field.summary.evaluation.observed_recipes,179);
 assert.match(field.model,/SVM/);assert.deepEqual(Array.from(field.features),['fat','egg','liquid']);
});
test('scores are continuous and sum to one; a focused view preserves the same underlying SVM scores',()=>{
 const point={fat:50,egg:200,liquid:70};const all=predict(field,point),focused=predict(field,point,focus),near=predict(field,{...point,liquid:70.0001});
 assert.ok(Math.abs(all.reduce((s,g)=>s+g.score,0)-1)<1e-9);
 for(const g of all)assert.ok(Math.abs(g.score-near.find(q=>q.category===g.category).score)<.0001);
 for(const g of focused)assert.equal(g.absolute,all.find(q=>q.category===g.category).absolute);
});
test('three-way SVM volume has no distance-cutoff holes and no cross-method stripes',()=>{
 const volume=buildVolume(field,anchors,{fat:110,egg:420,liquid:400},focus,[8,10,10]);
 assert.ok(volume.cells>0&&volume.cells<volume.totalCells);
 assert.ok(volume.voxels.every(v=>insideDomain(field,{fat:(v.indices[0]+.5)/8*110,egg:(v.indices[1]+.5)/10*420,liquid:(v.indices[2]+.5)/10*400})));
 assert.deepEqual(new Set(volume.voxels.flatMap(c=>c.categories.map(g=>g.category))),new Set(focus));
 assert.ok(volume.faces.every(f=>f.categories.length===1));if(volume.contact){assert.ok(volume.contact.mass>=.6);assert.ok(volume.contact.scores.every(g=>g.absolute>0));}
 assert.ok(volume.faces.every(f=>/^#[0-9a-f]{6}$/.test(f.color)));
});

test('outside-data extrapolation is an explicit view option; training points and the three-way contact remain inside',()=>{
 for(const a of anchors)assert.ok(insideDomain(field,a),a.id);
 assert.ok(insideDomain(field,{fat:64.1666666667,egg:166.25,liquid:41.6666666667}));
 assert.equal(insideDomain(field,{fat:110,egg:420,liquid:400}),false);
 const extrapolated=buildVolume(field,anchors,{fat:110,egg:420,liquid:400},focus,[8,10,10],true);
 assert.equal(extrapolated.cells,800);assert.equal(extrapolated.extrapolate,true);
});

test('field rows carry every public recipe for the point displays',()=>{
 assert.equal(field.rows.length,179);
 assert.ok(field.rows.every(r=>r.kind==='public-recipe'&&r.source&&r.source.url&&r.color&&r.method));
 assert.deepEqual(new Set(field.rows.map(r=>r.category)),new Set(field.classes));
});
test('2D projection is the union of actual 3D voxels along water, not a new 2D classifier',()=>{
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

test('boundary categories are training-only; display and generation use the original seven',()=>{
 const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
 const literal=html.match(/const DISPLAY_CATEGORIES = \[([^\]]*)\]/)[1];
 for(const name of ['パウンドケーキ','ジェノワーズ','シフォンケーキ','カステラ','エンゼルフード','ホットケーキ','クレープ'])assert.ok(literal.includes(name),name);
 for(const name of ['ソーダブレッド','スコーン','マフィン','ポップオーバー','ワッフル','フォカッチャ'])assert.ok(!literal.includes(name),name);
 assert.equal(field.classes.length,13);
 assert.ok(html.includes(':DISPLAY_CATEGORIES,'));
 assert.ok(html.includes('rows:DISPLAY_ROWS'));
});
