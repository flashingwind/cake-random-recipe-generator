// Data support and label overlap are computed from observed recipes, never anchors.
(function(root){
  const features=['fat','egg','liquid'];
  const distance=(a,b,scales)=>Math.sqrt(features.reduce((sum,key,i)=>sum+((a[key]-b[key])/scales[i])**2,0));
  function prepare(rows){
    const observed=rows.filter(r=>r.kind==='public-recipe');
    if(!observed.length)throw Error('No observed recipes');
    const scales=features.map(key=>{
      const mean=observed.reduce((s,r)=>s+r[key],0)/observed.length;
      return Math.sqrt(observed.reduce((s,r)=>s+(r[key]-mean)**2,0)/observed.length)||1;
    });
    const radii={};
    for(const category of new Set(observed.map(r=>r.category))){
      const group=observed.filter(r=>r.category===category);
      const nearest=group.map(r=>Math.min(...group.filter(q=>q.id!==r.id).map(q=>distance(r,q,scales)))).filter(Number.isFinite).sort((a,b)=>a-b);
      // A local-support heuristic, not a calibrated probability or a validity test.
      radii[category]=Math.max(.35,Math.min(1.25,nearest[Math.ceil(nearest.length*.9)-1]||.35));
    }
    return {rows:observed,scales,radii};
  }
  function inspect(model,point,method){
    const neighbors=model.rows.map(row=>({row,distance:distance(point,row,model.scales)})).sort((a,b)=>a.distance-b.distance || a.row.id.localeCompare(b.row.id));
    const supported=neighbors.filter(n=>n.distance<=model.radii[n.row.category]);
    if(!supported.length)return {type:'insufficient',neighbors:neighbors.slice(0,3),categories:[]};
    const groups=new Map();
    for(const n of supported.slice(0,5)){
      let group=groups.get(n.row.category);
      if(!group){group={category:n.row.category,color:n.row.color,method:n.row.method,weight:0,distance:n.distance};groups.set(n.row.category,group);}
      group.weight+=1/Math.max(.0025,n.distance**2);
    }
    const ranked=[...groups.values()].sort((a,b)=>b.weight-a.weight || a.category.localeCompare(b.category));
    const first=ranked[0];
    const other=ranked.find(g=>g.category!==first.category && g.method===first.method && g.distance<=first.distance*1.5+.15);
    const categories=other?[first,other]:[first];
    const relevant=first.method===method;
    return {type:!relevant?'other-method':other?'conflict':'supported',categories,neighbors:neighbors.slice(0,5)};
  }
  const api={prepare,inspect,distance};
  if(typeof module!=='undefined' && module.exports)module.exports=api;
  else root.RecipeRegions=api;
})(globalThis);
