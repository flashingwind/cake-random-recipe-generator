// Shared by the browser and the reproducible training/evaluation command.
(function(root){
  const FEATURES = ['fat', 'egg', 'liquid'];
  function fit(rows, k=5){
    if (!rows.length) throw new Error('Training data is empty');
    for (const row of rows) {
      if (!row.category || !row.color || !row.method || !['home','standard'].includes(row.profile) ||
          FEATURES.some(key=>!Number.isFinite(row[key]) || row[key]<0)) throw new Error('Invalid training row: '+row.id);
    }
    const means=FEATURES.map(key=>rows.reduce((s,r)=>s+r[key],0)/rows.length);
    const scales=FEATURES.map((key,i)=>Math.sqrt(rows.reduce((s,r)=>s+(r[key]-means[i])**2,0)/rows.length)||1);
    return {version:1, k, features:FEATURES, means, scales, rows};
  }
  function predict(model, point){
    const neighbors=model.rows.map(row=>({row,d:model.features.reduce((sum,key,i)=>sum+((point[key]-row[key])/model.scales[i])**2,0)}))
      .sort((a,b)=>a.d-b.d || a.row.id.localeCompare(b.row.id));
    // At a known coordinate use exact matches, avoiding an arbitrary finite weight.
    const selected=neighbors[0].d<1e-12 ? neighbors.filter(n=>n.d<1e-12) : neighbors.slice(0,model.k);
    const votes=new Map();
    for(const {row,d} of selected){
      const weight=1/Math.max(d,1e-12);
      let vote=votes.get(row.category);
      if(!vote){vote={category:row.category,color:row.color,method:row.method,weight:0,home:0,standard:0};votes.set(row.category,vote);}
      vote.weight+=weight; vote[row.profile]+=weight;
    }
    const winner=[...votes.values()].sort((a,b)=>b.weight-a.weight || a.category.localeCompare(b.category))[0];
    return {...winner, profile:winner.home>=winner.standard?'home':'standard', confidence:winner.weight/[...votes.values()].reduce((s,v)=>s+v.weight,0)};
  }
  const api={fit,predict};
  if(typeof module!=='undefined' && module.exports)module.exports=api;
  else root.RecipeClassifier=api;
})(globalThis);
