// Data support and label overlap are computed from observed recipes, never anchors.
(function(root){
  const defaultFeatures=['fat','egg','liquid'];
  const distance=(a,b,scales,features=defaultFeatures)=>Math.sqrt(features.reduce((sum,key,i)=>sum+((a[key]-b[key])/scales[i])**2,0));
  function prepare(rows,features=defaultFeatures){
    const observed=rows.filter(r=>r.kind==='public-recipe');
    if(!observed.length)throw Error('No observed recipes');
    const scales=features.map(key=>{
      const mean=observed.reduce((s,r)=>s+r[key],0)/observed.length;
      return Math.sqrt(observed.reduce((s,r)=>s+(r[key]-mean)**2,0)/observed.length)||1;
    });
    const radii={};
    for(const category of new Set(observed.map(r=>r.category))){
      const group=observed.filter(r=>r.category===category);
      const nearest=group.map(r=>Math.min(...group.filter(q=>q.id!==r.id).map(q=>distance(r,q,scales,features)))).filter(Number.isFinite).sort((a,b)=>a-b);
      // A local-support heuristic, not a calibrated probability or a validity test.
      radii[category]=Math.max(.35,Math.min(1.25,nearest[Math.ceil(nearest.length*.9)-1]||.35));
    }
    return {rows:observed,scales,radii,features:[...features]};
  }
  function inspect(model,point,method){
    const neighbors=model.rows.map(row=>({row,distance:distance(point,row,model.scales,model.features)})).sort((a,b)=>a.distance-b.distance || a.row.id.localeCompare(b.row.id));
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
  function buildVolume(model,anchors,limits,resolution=[18,24,24]){
    const keys=['fat','egg','liquid'],cells=new Map();
    const key=(x,y,z)=>`${x},${y},${z}`;
    for(let x=0;x<resolution[0];x++)for(let y=0;y<resolution[1];y++)for(let z=0;z<resolution[2];z++){
      const indices=[x,y,z],point=Object.fromEntries(keys.map((f,i)=>[f,(indices[i]+.5)/resolution[i]*limits[f]]));
      const result=inspect(model,point,'foam');
      if(!result.categories.length)continue;
      const categories=result.categories;
      const profiles=categories.map(g=>{
        const candidates=anchors.filter(a=>anchors.find(b=>b.id===a.id.replace(/-home$/,'')).name===g.category);
        candidates.sort((a,b)=>distance(point,a,model.scales,model.features)-distance(point,b,model.scales,model.features));
        return /[（(]家庭用[）)]/.test(candidates[0].name)?'home':'standard';
      });
      const cell={indices,categories,profiles,signature:categories.map((g,i)=>g.category+':'+profiles[i]).join('|')};
      cells.set(key(x,y,z),cell);
    }
    const faces=[];
    for(const cell of cells.values())for(let axis=0;axis<3;axis++)for(const side of [-1,1]){
      const neighbor=[...cell.indices];neighbor[axis]+=side;
      if(cells.get(key(...neighbor))?.signature===cell.signature)continue;
      const others=[0,1,2].filter(i=>i!==axis);
      const vertices=[[0,0],[1,0],[1,1],[0,1]].map(corner=>{
        const v=[...cell.indices];v[axis]+=side===1?1:0;
        others.forEach((i,j)=>v[i]+=corner[j]);
        return v.map((n,i)=>n/resolution[i]*2-1);
      });
      faces.push({vertices,categories:cell.categories,profiles:cell.profiles});
    }
    return {faces,cells:cells.size,totalCells:resolution.reduce((a,b)=>a*b,1),resolution};
  }
  const api={prepare,inspect,distance,buildVolume};
  if(typeof module!=='undefined' && module.exports)module.exports=api;
  else root.RecipeRegions=api;
})(globalThis);
