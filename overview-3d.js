// A dependency-free, rotatable projection of all observed recipes.
(function(root){
  function create(canvas,{rows,anchors,drawMarker,getState,onSelect,buildVolume}){
    const ctx=canvas.getContext('2d');
    const limits={fat:Math.max(110,...rows.map(r=>r.fat)),egg:Math.max(420,...rows.map(r=>r.egg)),liquid:Math.max(400,...rows.map(r=>r.liquid))};
    const volume=buildVolume(limits);
    let showRegions=true;
    let width=960,height=540;
    let yaw=-.65,pitch=.3,zoom=1,drag=null,points=[];
    function project(v){
      const [x,y,z]=v;
      const rx=x*Math.cos(yaw)+z*Math.sin(yaw),rz=-x*Math.sin(yaw)+z*Math.cos(yaw);
      const ry=y*Math.cos(pitch)-rz*Math.sin(pitch),depth=y*Math.sin(pitch)+rz*Math.cos(pitch);
      const scale=Math.min(width*.25,height*.27)*zoom*5/(5+depth);
      return {x:width/2+rx*scale,y:height/2-ry*scale,depth};
    }
    function coordinates(row){return [row.fat/limits.fat*2-1,row.egg/limits.egg*2-1,row.liquid/limits.liquid*2-1];}
    function line(a,b,color){const p=project(a),q=project(b);ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);ctx.strokeStyle=color;ctx.stroke();}
    function labelText(text,x,y){
      const half=ctx.measureText(String(text)).width/2;
      ctx.fillText(text,Math.max(half+5,Math.min(width-half-5,x)),Math.max(18,Math.min(height-8,y)));
    }
    function paintVolume(){
      if(!showRegions)return;
      const faces=volume.faces.map(face=>({...face,projected:face.vertices.map(project)}));
      faces.sort((a,b)=>b.projected.reduce((s,p)=>s+p.depth,0)-a.projected.reduce((s,p)=>s+p.depth,0));
      for(const face of faces){
        const ps=face.projected;
        ctx.save();ctx.beginPath();ps.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();
        ctx.globalAlpha=face.profiles[0]==='standard'?.18:.09;ctx.fillStyle=face.categories[0].color;ctx.fill();
        if(face.categories.length>1){
          ctx.clip();ctx.globalAlpha=face.profiles[1]==='standard'?.26:.15;ctx.strokeStyle=face.categories[1].color;ctx.lineWidth=2;
          const left=Math.min(...ps.map(p=>p.x)),right=Math.max(...ps.map(p=>p.x)),top=Math.min(...ps.map(p=>p.y)),bottom=Math.max(...ps.map(p=>p.y));
          for(let d=Math.floor((left+top)/6)*6;d<=right+bottom;d+=6){ctx.beginPath();ctx.moveTo(d-top,top);ctx.lineTo(d-bottom,bottom);ctx.stroke();}
        }
        ctx.restore();
      }
    }
    function render(){
      width=canvas.clientWidth || 960;height=canvas.clientHeight || 540;
      const ratio=window.devicePixelRatio || 1;
      if(canvas.width!==Math.round(width*ratio) || canvas.height!==Math.round(height*ratio)){
        canvas.width=Math.round(width*ratio);canvas.height=Math.round(height*ratio);
      }
      ctx.setTransform(ratio,0,0,ratio,0,0);
      ctx.clearRect(0,0,width,height);ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);
      paintVolume();
      const corners=[];for(const x of [-1,1])for(const y of [-1,1])for(const z of [-1,1])corners.push([x,y,z]);
      for(let i=0;i<corners.length;i++)for(let j=i+1;j<corners.length;j++)if(corners[i].filter((v,k)=>v!==corners[j][k]).length===1)line(corners[i],corners[j],'#e3d9d2');
      const origin=[-1,-1,-1];
      for(const [index,key,label] of [[0,'fat','純脂肪'],[1,'egg','卵'],[2,'liquid','水分']]){
        const end=[...origin];end[index]=1;line(origin,end,'#6b5d54');
        ctx.font='14px sans-serif';ctx.fillStyle='#6b5d54';ctx.textAlign='center';
        for(const fraction of [0,.5,1]){
          const v=[...origin];v[index]=fraction*2-1;
          const p=project(v);labelText(Math.round(limits[key]*fraction),p.x+(index===1?-17:0),p.y+(index===1?4:17));
        }
        const v=[...end];v[index]=1.3;const p=project(v);ctx.font='bold 16px sans-serif';labelText(label+' g',p.x,p.y);
      }
      const base=anchors.filter(a=>!a.id.endsWith('-home'));
      points=rows.map(row=>({...project(coordinates(row)),row,kind:'recipe',shape:base.find(a=>a.name===row.category).shape,radius:4.5}));
      const reference=anchors.map(row=>({...project(coordinates(row)),row,kind:'anchor',shape:row.shape,radius:7}));
      for(const p of [...points,...reference].sort((a,b)=>b.depth-a.depth)){
        drawMarker(ctx,p.shape,p.x,p.y,p.radius,p.kind==='anchor'?'#fff':p.row.color,p.kind==='anchor'?p.row.color:'#fff',p.kind==='anchor'?2:1);
      }
      const current=project(coordinates(getState()));ctx.fillStyle='#b3261e';ctx.font='24px sans-serif';ctx.textAlign='center';ctx.fillText('★',current.x,current.y+8);
      canvas.setAttribute('aria-label',`脂肪・卵・水分の3D全体図。全${rows.length}件の実レシピと${anchors.length}件のアンカー。矢印キーで回転、プラス・マイナスで拡大縮小。`);
    }
    function reset(){yaw=-.65;pitch=.3;zoom=1;render();}
    function changeZoom(factor){zoom=Math.max(.65,Math.min(1.5,zoom*factor));render();}
    canvas.addEventListener('pointerdown',event=>{if(event.button!==0)return;drag={x:event.clientX,y:event.clientY,startX:event.clientX,startY:event.clientY,moved:false};canvas.setPointerCapture(event.pointerId);});
    canvas.addEventListener('pointermove',event=>{
      if(!drag)return;
      if(Math.hypot(event.clientX-drag.startX,event.clientY-drag.startY)>4)drag.moved=true;
      yaw+=(event.clientX-drag.x)*.009;pitch=Math.max(-1.2,Math.min(1.2,pitch+(event.clientY-drag.y)*.009));
      drag.x=event.clientX;drag.y=event.clientY;render();
    });
    canvas.addEventListener('pointerup',event=>{
      if(!drag)return;
      if(!drag.moved){
        const rect=canvas.getBoundingClientRect(),x=(event.clientX-rect.left)*width/rect.width,y=(event.clientY-rect.top)*height/rect.height;
        const nearest=[...points].sort((a,b)=>Math.hypot(a.x-x,a.y-y)-Math.hypot(b.x-x,b.y-y))[0];
        if(nearest && Math.hypot(nearest.x-x,nearest.y-y)<16)onSelect(nearest.row);
      }
      drag=null;
    });
    canvas.addEventListener('pointercancel',()=>{drag=null;});
    canvas.addEventListener('keydown',event=>{
      if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)){
        event.preventDefault();yaw+=event.key==='ArrowLeft'?-.12:event.key==='ArrowRight'?.12:0;
        pitch=Math.max(-1.2,Math.min(1.2,pitch+(event.key==='ArrowUp'?-.12:event.key==='ArrowDown'?.12:0)));render();
      }else if(event.key==='+'||event.key==='='){event.preventDefault();changeZoom(1.1);}
      else if(event.key==='-'){event.preventDefault();changeZoom(1/1.1);}
      else if(event.key==='Home'){event.preventDefault();reset();}
    });
    const resizeObserver=new ResizeObserver(()=>render());resizeObserver.observe(canvas);
    return {render,reset,changeZoom,setRegions:enabled=>{showRegions=enabled;render();},getVolume:()=>volume,getPoints:()=>points.map(p=>({id:p.row.id,x:p.x,y:p.y}))};
  }
  root.RecipeOverview={create};
})(globalThis);
