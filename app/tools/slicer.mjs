import { PNG } from 'pngjs'
import fs from 'fs'

// 레포 루트에서 실행: node tools/slicer.mjs
const png = PNG.sync.read(fs.readFileSync('tools/pet_all.png'))
const { width: W, height: H, data } = png
const idx=(x,y)=>(y*W+x)*4
const bgPx=[data[0],data[1],data[2]]
const isBg=(x,y)=>{const i=idx(x,y);return Math.abs(data[i]-bgPx[0])+Math.abs(data[i+1]-bgPx[1])+Math.abs(data[i+2]-bgPx[2])<28}
function bands1d(c,minGap,minLen){const out=[];let s=-1;for(let i=0;i<c.length;i++){if(c[i]>0){if(s<0)s=i}else{if(s>=0){out.push([s,i-1]);s=-1}}}if(s>=0)out.push([s,c.length-1]);const m=[];for(const b of out){if(m.length&&b[0]-m[m.length-1][1]<minGap)m[m.length-1][1]=b[1];else m.push([...b])}return m.filter(b=>b[1]-b[0]+1>=minLen)}
function colBandsIn(x0,x1,y0,y1,minGap,minLen){const col=new Array(x1-x0+1).fill(0);for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)if(!isBg(x,y))col[x-x0]++;return bands1d(col,minGap,minLen).map(b=>[b[0]+x0,b[1]+x0])}
function splitWidestUntil(bands,n){bands=bands.map(b=>[...b]);while(bands.length<n){let wi=0;for(let i=1;i<bands.length;i++)if((bands[i][1]-bands[i][0])>(bands[wi][1]-bands[wi][0]))wi=i;const [a,b]=bands[wi],mid=Math.floor((a+b)/2);bands.splice(wi,1,[a,mid],[mid+1,b])}return bands}
function tighten(x0,x1,y0,y1){let nx0=x1,nx1=x0,ny0=y1,ny1=y0,f=false;for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)if(!isBg(x,y)){f=true;if(x<nx0)nx0=x;if(x>nx1)nx1=x;if(y<ny0)ny0=y;if(y>ny1)ny1=y}if(!f)return null;const p=2;return [Math.max(0,nx0-p),Math.min(W-1,nx1+p),Math.max(0,ny0-p),Math.min(H-1,ny1+p)]}
// pick the TALL sprite band within a cell, dropping thin label text bands
function spriteBox(bx0,bx1,y0,y1){
  const rows=new Array(y1-y0+1).fill(0)
  for(let y=y0;y<=y1;y++)for(let x=bx0;x<=bx1;x++)if(!isBg(x,y))rows[y-y0]++
  const vb=bands1d(rows,6,1).map(b=>[b[0]+y0,b[1]+y0])
  if(!vb.length)return null
  let best=vb[0];for(const b of vb)if((b[1]-b[0])>(best[1]-best[0]))best=b
  return tighten(bx0,bx1,best[0],best[1])
}
function extract(x0,x1,y0,y1){const w=x1-x0+1,h=y1-y0+1,out=new PNG({width:w,height:h});for(let y=0;y<h;y++)for(let x=0;x<w;x++){const si=idx(x0+x,y0+y),di=(y*w+x)*4;out.data[di]=data[si];out.data[di+1]=data[si+1];out.data[di+2]=data[si+2];out.data[di+3]=255}const seen=new Uint8Array(w*h),q=[];const pushIf=(x,y)=>{if(x<0||y<0||x>=w||y>=h)return;const k=y*w+x;if(seen[k])return;if(isBg(x0+x,y0+y)){seen[k]=1;out.data[(y*w+x)*4+3]=0;q.push([x,y])}};for(let x=0;x<w;x++){pushIf(x,0);pushIf(x,h-1)}for(let y=0;y<h;y++){pushIf(0,y);pushIf(w-1,y)}while(q.length){const [x,y]=q.pop();pushIf(x+1,y);pushIf(x-1,y);pushIf(x,y+1);pushIf(x,y-1)}return out}

const rowBands=[[48,189],[233,361],[412,532],[587,708],[751,871],[908,1019]]
const creatures=[['quokka'],['lizard'],['dog'],['panda'],['hedgehog'],['sloth'],['axolotl'],['cat'],['bird'],['capybara'],['penguin'],['chameleon']]
const groups={L:[0,738],R:[760,1535]}
const outDir='src/renderer/assets/pets'
fs.rmSync(outDir,{recursive:true,force:true});fs.mkdirSync(outDir,{recursive:true})
const cells=[]
for(let r=0;r<6;r++){const [y0,y1]=rowBands[r]
  for(const side of ['L','R']){const [gx0,gx1]=groups[side]
    let cb=colBandsIn(gx0,gx1,y0,y1,10,8)
    if(cb.length>=1)cb=cb.slice(1)
    if(cb.length>5)cb=cb.slice(0,5)
    if(cb.length<5)cb=splitWidestUntil(cb,5)
    const slug=creatures[(side==='L'?0:6)+r][0]
    cb.forEach((b,si)=>{const box=spriteBox(b[0],b[1],y0,y1);if(box)cells.push({slug,stage:si+1,box})})
  }}
for(const c of cells){const d=`${outDir}/${c.slug}`;fs.mkdirSync(d,{recursive:true});fs.writeFileSync(`${d}/${c.stage}.png`,PNG.sync.write(extract(...c.box)))}
console.log('wrote',cells.length,'sprites')
const CS=110,sheet=new PNG({width:CS*5,height:CS*12});for(let i=0;i<sheet.data.length;i+=4){sheet.data[i]=240;sheet.data[i+1]=240;sheet.data[i+2]=242;sheet.data[i+3]=255}
const order=creatures.map(c=>c[0])
for(const c of cells){const img=extract(...c.box),row=order.indexOf(c.slug),colc=c.stage-1,scale=Math.min((CS-8)/img.width,(CS-8)/img.height,1),dw=Math.round(img.width*scale),dh=Math.round(img.height*scale),ox=colc*CS+Math.floor((CS-dw)/2),oy=row*CS+Math.floor((CS-dh)/2);for(let y=0;y<dh;y++)for(let x=0;x<dw;x++){const sx=Math.floor(x/scale),sy=Math.floor(y/scale),si=(sy*img.width+sx)*4;if(img.data[si+3]===0)continue;const di=((oy+y)*sheet.width+(ox+x))*4;sheet.data[di]=img.data[si];sheet.data[di+1]=img.data[si+1];sheet.data[di+2]=img.data[si+2];sheet.data[di+3]=255}}
fs.writeFileSync('tools/slices_preview.png',PNG.sync.write(sheet))
console.log('contact sheet -> tools/slices_preview.png')
