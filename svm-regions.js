// Interpolate the trained classifier's full probability field. No nearest-neighbor
// voting or distance cutoff participates in region classification.
(function(root){
  const palette={'パウンドケーキ':'#c96f2e','ジェノワーズ':'#4a7fb5','シフォンケーキ':'#5da24a','カステラ':'#8a5fb0','エンゼルフード':'#c2a13d','ホットケーキ':'#e8912d','クレープ':'#6a9a7d','ソーダブレッド':'#9c6644','スコーン':'#e07a5f','マフィン':'#bc4749','ポップオーバー':'#2a9d8f','ワッフル':'#e76f51','フォカッチャ':'#606c38'};
  const methods={'パウンドケーキ':'cream','ジェノワーズ':'foam','シフォンケーキ':'separate','カステラ':'foam','エンゼルフード':'separate','ホットケーキ':'mix','クレープ':'mix','ソーダブレッド':'mix','スコーン':'mix','マフィン':'mix','ポップオーバー':'mix','ワッフル':'mix','フォカッチャ':'mix'};
  function predict(field,point,selected=field.classes){
    const coordinates=field.features.map((key,i)=>{
      const axis=field.axes[i],position=Math.max(0,Math.min(axis.length-1,(point[key]-axis[0])/(axis[1]-axis[0])));
      const low=Math.min(axis.length-2,Math.floor(position));return {low,t:position-low};
    });
    const probabilities=field.classes.map(()=>0);
    for(const a of [0,1])for(const b of [0,1])for(const c of [0,1]){
      const corner=[a,b,c],indices=coordinates.map((q,i)=>q.low+corner[i]);
      const weight=coordinates.reduce((p,q,i)=>p*(corner[i]?q.t:1-q.t),1);
      const values=field.probabilities[(indices[0]*field.axes[1].length+indices[1])*field.axes[2].length+indices[2]];
      values.forEach((p,i)=>probabilities[i]+=p*weight);
    }
    const total=field.classes.reduce((sum,name,i)=>sum+(selected.includes(name)?probabilities[i]:0),0);
    // A selected subset can carry zero rounded mass at a point (e.g. KDE tails);
    // fall back to a uniform split rather than dividing by zero.
    return field.classes.map((category,i)=>({category,color:palette[category],method:methods[category],score:total>0?probabilities[i]/total:(selected.includes(category)?1/selected.length:0),absolute:probabilities[i]}))
      .filter(g=>selected.includes(g.category)).sort((a,b)=>b.score-a.score||a.category.localeCompare(b.category));
  }
  function blend(scores){
    const rgb=[0,0,0];for(const g of scores){const n=parseInt(g.color.slice(1),16);[n>>16&255,n>>8&255,n&255].forEach((v,i)=>rgb[i]+=v*g.score);}
    return '#'+rgb.map(v=>Math.round(v).toString(16).padStart(2,'0')).join('');
  }
  function insideDomain(field,point){
    if(!field.domain)return true;
    const v=field.features.map((key,i)=>point[key]/field.domain.scale[i]);
    return field.domain.equations.every(eq=>eq.slice(0,3).reduce((sum,n,i)=>sum+n*v[i],eq[3])<=1e-9);
  }
  function buildVolume(field,anchors,limits,selected=field.classes,resolution=[18,24,24],extrapolate=false,carve=null){
    const voxels=[];let contact=null;
    for(let x=0;x<resolution[0];x++)for(let y=0;y<resolution[1];y++)for(let z=0;z<resolution[2];z++){
      const indices=[x,y,z],point=Object.fromEntries(field.features.map((f,i)=>[f,(indices[i]+.5)/resolution[i]*limits[f]]));
      if(!extrapolate && !insideDomain(field,point))continue;
      const scores=predict(field,point,selected),first=scores[0];
      // Optional carve: drop voxels the caller's mechanism model rejects
      // (e.g. cannot rise). Carved voxels leave the volume entirely, no grey.
      if(carve&&carve(first.category,point))continue;
      const other=scores.find(g=>g.category!==first.category&&g.method===first.method&&g.score>=first.score*.75);
      const categories=other?[first,other]:[first];
      const profiles=categories.map(g=>{
        const candidates=anchors.filter(a=>anchors.find(b=>b.id===a.id.replace(/-home$/,'')).name===g.category);
        candidates.sort((a,b)=>field.features.reduce((d,f)=>d+((point[f]-a[f])/limits[f])**2,0)-field.features.reduce((d,f)=>d+((point[f]-b[f])/limits[f])**2,0));
        return candidates[0].id.endsWith('-home')?'home':'standard';
      });
      voxels.push({indices,categories,profiles,color:blend(scores),signature:categories.map((g,i)=>g.category+':'+profiles[i]).join('|')});
      if(selected.length===3){
        const all=predict(field,point),outside=all.filter(g=>!selected.includes(g.category));
        const mass=scores.reduce((sum,g)=>sum+g.absolute,0),otherMax=Math.max(0,...outside.map(g=>g.absolute));
        const gap=scores[0].score-scores[2].score;
        // Do not invent a three-way contact in a region dominated by another cake.
        if(mass>=.6 && scores[2].absolute>=otherMax && (!contact||gap<contact.gap))contact={point,scores,gap,mass};
      }
    }
    return {...meshVolume(voxels,resolution),contact,selected,model:field.estimator,extrapolate};
  }
  function meshVolume(voxels,resolution){
    const key=(x,y,z)=>`${x},${y},${z}`;
    const cells=new Map(voxels.map(cell=>[key(...cell.indices),cell]));
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
      faces.push({vertices,categories:cell.categories,profiles:cell.profiles,color:cell.color});
    }
    return {faces,voxels:[...cells.values()],cells:cells.size,totalCells:resolution.reduce((a,b)=>a*b,1),resolution};
  }
  // The 2D view is a projection of the 3D model voxels along the water axis, never a second classifier.
  function projectVolume(volume,limits){
    const columns=new Map();
    for(const voxel of volume.voxels){
      const key=voxel.indices.slice(0,2).join(',');
      if(!columns.has(key))columns.set(key,new Map());
      const groups=columns.get(key);
      voxel.categories.forEach((category,i)=>{
        let g=groups.get(category.category);
        if(!g){g={...category,depth:0,home:0,standard:0};groups.set(category.category,g);}
        g.depth++;g[voxel.profiles[i]]++;
      });
    }
    return {inspect(point,method){
      const x=Math.min(volume.resolution[0]-1,Math.max(0,Math.floor(point.fat/limits.fat*volume.resolution[0])));
      const y=Math.min(volume.resolution[1]-1,Math.max(0,Math.floor(point.egg/limits.egg*volume.resolution[1])));
      const all=[...(columns.get(`${x},${y}`)?.values()||[])];
      if(!all.length)return {type:'insufficient',categories:[]};
      const relevant=all.filter(g=>g.method===method).sort((a,b)=>b.depth-a.depth||a.category.localeCompare(b.category));
      const categories=(relevant.length?relevant:all).slice(0,2).map(g=>({...g,profile:g.home>=g.standard?'home':'standard'}));
      return {type:!relevant.length?'other-method':relevant.length>1?'conflict':'supported',categories};
    }};
  }
  const api={predict,blend,buildVolume,insideDomain,meshVolume,projectVolume};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else root.SVMRegions=api;
})(globalThis);
