// A dependency-free, rotatable projection of all observed recipes.
(function(root){
  function create(canvas,{rows,anchors,drawMarker,getState,onSelect}){
    const ctx=canvas.getContext('2d');
    const limits={fat:Math.max(110,...rows.map(r=>r.fat)),egg:Math.max(420,...rows.map(r=>r.egg)),liquid:Math.max(400,...rows.map(r=>r.liquid))};
    let yaw=-.65,pitch=.3,zoom=1,drag=null,points=[];
    function project(v){
      const [x,y,z]=v;
      const rx=x*Math.cos(yaw)+z*Math.sin(yaw),rz=-x*Math.sin(yaw)+z*Math.cos(yaw);
      const ry=y*Math.cos(pitch)-rz*Math.sin(pitch),depth=y*Math.sin(pitch)+rz*Math.cos(pitch);
      const scale=130*zoom*5/(5+depth);
      return {x:canvas.width/2+rx*scale,y:canvas.height/2-ry*scale,depth};
    }
    function coordinates(row){return [row.fat/limits.fat*2-1,row.egg/limits.egg*2-1,row.liquid/limits.liquid*2-1];}
    function line(a,b,color){const p=project(a),q=project(b);ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);ctx.strokeStyle=color;ctx.stroke();}
    function render(){
      ctx.clearRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
      const corners=[];for(const x of [-1,1])for(const y of [-1,1])for(const z of [-1,1])corners.push([x,y,z]);
      for(let i=0;i<corners.length;i++)for(let j=i+1;j<corners.length;j++)if(corners[i].filter((v,k)=>v!==corners[j][k]).length===1)line(corners[i],corners[j],'#e3d9d2');
      const origin=[-1,-1,-1];
      for(const [index,key,label] of [[0,'fat','純脂肪'],[1,'egg','卵'],[2,'liquid','水分']]){
        const end=[...origin];end[index]=1;line(origin,end,'#6b5d54');
        ctx.font='13px sans-serif';ctx.fillStyle='#6b5d54';ctx.textAlign='center';
        for(const fraction of [0,.5,1]){
          const v=[...origin];v[index]=fraction*2-1;
          const p=project(v);ctx.fillText(Math.round(limits[key]*fraction),p.x+(index===1?-17:0),p.y+(index===1?4:17));
        }
        const v=[...end];v[index]=1.3;const p=project(v);ctx.font='bold 15px sans-serif';ctx.fillText(label+' g',p.x,p.y);
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
        const rect=canvas.getBoundingClientRect(),x=(event.clientX-rect.left)*canvas.width/rect.width,y=(event.clientY-rect.top)*canvas.height/rect.height;
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
    return {render,reset,changeZoom,getPoints:()=>points.map(p=>({id:p.row.id,x:p.x,y:p.y}))};
  }
  root.RecipeOverview={create};
})(globalThis);
