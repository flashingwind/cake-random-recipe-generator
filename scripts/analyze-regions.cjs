// Observed evidence only. These are review/collection priorities, not corrected labels.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {prepare,inspect}=require('../region-grid.js');
const root=path.resolve(__dirname,'..'),context={};
vm.runInNewContext(fs.readFileSync(path.join(root,'data/classifier-model.js'),'utf8'),context);
const rows=context.RECIPE_MODEL.rows.filter(r=>r.kind==='public-recipe');
const compact=r=>({id:r.id,category:r.category,method:r.method,source:r.source,
  features:Object.fromEntries(['fat','egg','sugar','liquid','bp'].map(k=>[k,r[k]]))});
const candidates=rows.map(row=>{
  const others=rows.filter(r=>r.source.url!==row.source.url);
  const model=prepare(others),result=inspect(model,row,row.method);
  const supported=result.type!=='insufficient';
  const intrusion=supported && result.categories[0].category!==row.category;
  const overlap=result.type==='conflict';
  return {recipe:compact(row),classificationWithoutSameSource:supported?result.categories[0].category:null,
    suspectedIntrusion:intrusion,nearbyLabelConflict:overlap,status:result.type,
    nearest:result.neighbors.slice(0,3).map(n=>({recipe:compact(n.row),distance:n.distance}))};
}).filter(r=>r.suspectedIntrusion||r.nearbyLabelConflict)
.sort((a,b)=>Number(b.suspectedIntrusion)-Number(a.suspectedIntrusion)||a.nearest[0].distance-b.nearest[0].distance);
const report={observedRecipes:rows.length,syntheticRecipesAdded:0,
  method:'3 standardized features (fat, egg, liquid); overlap only within the same method; exclude all records sharing the query source URL, refit support/scales; compare nearby observed labels',
  caution:'Review candidates are not proven data errors. Check ingredient conversion, method, missing features and label conventions against sources. Not a comparison with the old fixed SVM slice.',
  suspectedIntrusions:candidates.filter(r=>r.suspectedIntrusion).length,
  nearbyLabelConflicts:candidates.filter(r=>r.nearbyLabelConflict).length,candidates};
fs.writeFileSync(path.join(root,'data/region-review.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({observedRecipes:report.observedRecipes,suspectedIntrusions:report.suspectedIntrusions,nearbyLabelConflicts:report.nearbyLabelConflicts}));
