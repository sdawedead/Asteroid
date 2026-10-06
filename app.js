import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.181.0/build/three.module.js';
import { mergeVertices } from 'https://cdn.jsdelivr.net/npm/three@0.181.0/examples/jsm/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.181.0/examples/jsm/loaders/GLTFLoader.js';

const EYE_HEIGHT = 1.72;
const WORLDS = {
  bennu: {
    name:'BENNU', proper:'101955 Bennu', type:'OSIRIS-REx Nightingale site', size:'492 m',
    radius:246, rotation:'4.30 h', gravity:0.00008, gravityText:'0.00008 m/s2', escape:0.20, escapeText:'0.20 m/s',
    jumpSpeed:0.012, timeScale:35, walkSpeed:.9, terrainSize:300, roughness:2.4,
    color:0x292b2c, rockColor:0x343637, smallBoulders:2200, largeBoulders:58,
    previewScale:[1.0,1.02,.96], previewKind:'bennu', seed:213, previewImage:'./assets/mission_bennu.jpg', previewSource:'NASA / OSIRIS-REx'
  },
  eros: {
    name:'EROS', proper:'433 Eros', type:'S-type near-Earth asteroid', size:'33 x 13 x 13 km',
    radius:8400, rotation:'5.27 h', gravity:0.0059, gravityText:'~0.0059 m/s2', escape:10.0, escapeText:'~10 m/s',
    jumpSpeed:.12, timeScale:8, walkSpeed:1.15, terrainSize:1000, roughness:8.5,
    color:0x51483f, rockColor:0x62574c, smallBoulders:310, largeBoulders:34,
    previewScale:[2.15,.82,.78], previewKind:'eros', seed:577, previewImage:'./assets/mission_eros.jpg', previewSource:'NASA / NEAR SHOEMAKER'
  },
  kleopatra: {
    name:'KLEOPATRA', proper:'216 Kleopatra', type:'Metal-rich dog-bone asteroid', size:'~270 km long',
    radius:60000, rotation:'5.39 h', gravity:0.057, gravityText:'~0.057 m/s2*', escape:82, escapeText:'~82 m/s*',
    jumpSpeed:.42, timeScale:3, walkSpeed:1.2, terrainSize:1700, roughness:12,
    color:0x4c4f51, rockColor:0x595d60, smallBoulders:260, largeBoulders:30,
    previewScale:[1,1,1], previewKind:'kleopatra', seed:931, previewImage:'./assets/mission_kleopatra.jpg', previewSource:'ESO / VLT SPHERE'
  }
};

const $ = s => document.querySelector(s);
const canvas = $('#scene');
const landing = $('#landing');
const hud = $('#hud');
const science = $('#science');
const visor = $('#visor');
const escapeOverlay = $('#escapeOverlay');
const landBtn = $('#landBtn');
const cardsWrap = $('#asteroidCards');
const isTouch = matchMedia('(pointer:coarse)').matches;
let qualityMode=localStorage.getItem('asteroidWalkQuality')==='balanced'?'balanced':'hd';
let starField=null;

let selectedKey='bennu';
let world=WORLDS[selectedKey];
let mode='landing';
let terrainGroup=new THREE.Group();
let previewGroup=new THREE.Group();
let orbitGroup=new THREE.Group();
let walkGround=null;
const groundRaycaster=new THREE.Raycaster();
const groundRayOrigin=new THREE.Vector3();
const DOWN_AXIS=new THREE.Vector3(0,-1,0);
const groundNormalMatrix=new THREE.Matrix3();
let clock=new THREE.Clock();
let player={x:0,z:0,yaw:0,pitch:-.10,jumpY:0,vY:0,distance:0,escaping:false,escapeLift:0,escapeTimer:0,bob:0,moving:false};
const orbitPos=new THREE.Vector3();
let orbitYaw=0,orbitPitch=-1.15,orbitTransition=null,savedSurface=null;
const keys=new Set();
let joy={x:0,y:0,id:null};

const nightingale={meta:null,grid:null,ready:false,promise:null};
let nightingaleGeometry=null,nightingaleModelPromise=null;
function preloadNightingale(){
  nightingale.promise=Promise.all([
    fetch('./assets/nightingale_meta.json').then(r=>{if(!r.ok)throw new Error('meta '+r.status);return r.json()}),
    fetch('./assets/nightingale_height.bin').then(r=>{if(!r.ok)throw new Error('height '+r.status);return r.arrayBuffer()})
  ]).then(([meta,buf])=>{
    const grid=new Float32Array(buf);
    if(grid.length!==meta.gridSize*meta.gridSize)throw new Error('Nightingale grid size mismatch');
    meta.cx=(meta.xmin+meta.xmax)/2;meta.cz=(meta.zmin+meta.zmax)/2;
    meta.width=meta.xmax-meta.xmin;meta.depth=meta.zmax-meta.zmin;
    nightingale.meta=meta;nightingale.grid=grid;nightingale.ready=true;
    WORLDS.bennu.terrainSize=Math.min(meta.width,meta.depth);
    return nightingale;
  }).catch(err=>{console.warn('NASA Nightingale terrain fallback:',err);return null});
}
preloadNightingale();

function loadNightingaleGeometry(onProgress=()=>{}){
  if(nightingaleGeometry)return Promise.resolve(nightingaleGeometry);
  if(nightingaleModelPromise)return nightingaleModelPromise;
  nightingaleModelPromise=new Promise((resolve,reject)=>{
    const loader=new GLTFLoader();
    loader.load('./assets/nightingale.glb',gltf=>{
      gltf.scene.updateMatrixWorld(true);
      const source=gltf.scene.getObjectByProperty('isMesh',true);
      if(!source){reject(new Error('Nightingale GLB has no mesh'));return}
      const geometry=source.geometry;
      geometry.applyMatrix4(source.matrixWorld);
      const m=nightingale.meta,c=m.centerBennuMeters,bx=m.basisX,up=m.surfaceUp,bz=m.basisZ;
      const project=new THREE.Matrix4().set(
        bx[0]*1000,bx[1]*1000,bx[2]*1000,-(c[0]*bx[0]+c[1]*bx[1]+c[2]*bx[2]),
        up[0]*1000,up[1]*1000,up[2]*1000,-(c[0]*up[0]+c[1]*up[1]+c[2]*up[2]),
        bz[0]*1000,bz[1]*1000,bz[2]*1000,-(c[0]*bz[0]+c[1]*bz[1]+c[2]*bz[2]),
        0,0,0,1
      );
      geometry.applyMatrix4(project);
      const p=geometry.getAttribute('position'),uv=new Float32Array(p.count*2);
      for(let i=0;i<p.count;i++){
        uv[i*2]=(p.getX(i)-m.xmin)/m.width;
        uv[i*2+1]=1-(p.getZ(i)-m.zmin)/m.depth;
      }
      geometry.setAttribute('uv',new THREE.BufferAttribute(uv,2));
      geometry.computeVertexNormals();
      geometry.computeBoundingBox();geometry.computeBoundingSphere();
      nightingaleGeometry=geometry;resolve(geometry);
    },event=>onProgress(event),error=>{nightingaleModelPromise=null;reject(error)});
  });
  return nightingaleModelPromise;
}

const renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio||1,qualityMode==='hd'?(isTouch?1.7:2):(isTouch?1.45:1.8)));
renderer.setSize(innerWidth,innerHeight);
renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=.98;
renderer.shadowMap.enabled=true;
renderer.shadowMap.type=THREE.PCFSoftShadowMap;

const scene=new THREE.Scene();
scene.background=new THREE.Color(0x000000);
const camera=new THREE.PerspectiveCamera(64,innerWidth/innerHeight,.025,4000000);
camera.rotation.order='YXZ';
scene.add(camera,terrainGroup,previewGroup,orbitGroup);

const ambient=new THREE.AmbientLight(0xffffff,.07);
scene.add(ambient);
const sun=new THREE.DirectionalLight(0xfff8ee,4.6);
sun.castShadow=true;
sun.shadow.mapSize.set(isTouch?2048:4096,isTouch?2048:4096);
sun.shadow.bias=-.00015;
sun.shadow.normalBias=.025;
sun.shadow.camera.near=.1;
sun.shadow.camera.far=4200;
scene.add(sun);
scene.add(sun.target);

const Y_AXIS=new THREE.Vector3(0,1,0);
const tmpUp=new THREE.Vector3();
const tmpBase=new THREE.Vector3();
const tmpQUp=new THREE.Quaternion();
const tmpQLook=new THREE.Quaternion();
const tmpEuler=new THREE.Euler(0,0,0,'YXZ');

function mulberry32(a){return function(){let t=a+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296}}
function hash2(x,z,s=1){const v=Math.sin(x*127.1+z*311.7+s*74.7)*43758.5453123;return (v-Math.floor(v))*2-1}
function noise(x,z,s=1){
  const x0=Math.floor(x),z0=Math.floor(z),fx=x-x0,fz=z-z0;
  const u=fx*fx*(3-2*fx),v=fz*fz*(3-2*fz);
  const a=hash2(x0,z0,s),b=hash2(x0+1,z0,s),c=hash2(x0,z0+1,s),d=hash2(x0+1,z0+1,s);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a,b,u),THREE.MathUtils.lerp(c,d,u),v);
}
function fbm(x,z,s=1){let n=0,a=.58,f=1;for(let i=0;i<5;i++){n+=noise(x*f,z*f,s+i*19)*a;f*=2.05;a*=.48}return n}

function curvatureHeight(x,z){
  const r2=x*x+z*z, R=world.radius;
  if(r2>=R*R*.94) return -R*.75;
  return -R+Math.sqrt(Math.max(1,R*R-r2));
}
function reliefHeight(x,z){
  const scale=selectedKey==='bennu'?18:selectedKey==='eros'?42:58;
  let h=fbm(x/scale,z/scale,world.seed)*world.roughness;
  h+=fbm(x/(scale*.32),z/(scale*.32),world.seed+41)*world.roughness*.18;
  const crater=(cx,cz,r,d)=>{const q=Math.hypot(x-cx,z-cz)/r;if(q>1.25)return 0;const bowl=q<1?-d*(1-q*q):0;const rim=Math.exp(-Math.pow((q-1.02)/.09,2))*d*.28;return bowl+rim};
  if(selectedKey==='bennu'){
    h+=crater(-38,34,18,2.4)+crater(52,-43,12,1.5);
    h+=Math.max(0,1-Math.abs(z+66)/2.5)*.18*Math.sin(x*.5);
  }else if(selectedKey==='eros'){
    h+=crater(-120,90,70,8)+crater(160,-130,44,5);
    h+=Math.sin((x+z)*.025)*1.4;
  }else{
    h+=crater(-180,120,92,10)+crater(230,-190,68,7);
  }
  return h;
}
function nightingaleHeight(x,z){
  if(!nightingale.ready)return null;
  const m=nightingale.meta,N=m.gridSize,g=nightingale.grid;
  const ax=x+m.cx,az=z+m.cz;
  const u=THREE.MathUtils.clamp((ax-m.xmin)/(m.xmax-m.xmin)*(N-1),0,N-1);
  const v=THREE.MathUtils.clamp((az-m.zmin)/(m.zmax-m.zmin)*(N-1),0,N-1);
  const x0=Math.floor(u),z0=Math.floor(v),x1=Math.min(N-1,x0+1),z1=Math.min(N-1,z0+1),fx=u-x0,fz=v-z0;
  const h00=g[z0*N+x0],h10=g[z0*N+x1],h01=g[z1*N+x0],h11=g[z1*N+x1];
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(h00,h10,fx),THREE.MathUtils.lerp(h01,h11,fx),fz);
}
function usingRealBennu(){return selectedKey==='bennu'&&nightingale.ready}
function bennuVisualRoughness(x,z){
  if(!usingRealBennu())return 0;
  // Visual-only centimetre-scale breakup. The scientific heightfield remains the
  // collision/physics surface, while this removes the melted-CG look in shading.
  const a=noise(x*2.65,z*2.65,1601)*.050;
  const b=noise(x*6.10,z*6.10,1703)*.022;
  const chips=Math.sign(noise(x*9.2,z*8.7,1811))*.010;
  return a+b+chips;
}
function terrainHeight(x,z){
  if(usingRealBennu())return nightingaleHeight(x,z);
  return curvatureHeight(x,z)+reliefHeight(x,z);
}
function sampleGround(x,z,outNormal=null){
  if(usingRealBennu()&&qualityMode==='hd'&&walkGround){
    walkGround.updateMatrixWorld(true);
    groundRayOrigin.set(x,120,z);
    groundRaycaster.set(groundRayOrigin,DOWN_AXIS);
    groundRaycaster.near=0;groundRaycaster.far=260;
    const hit=groundRaycaster.intersectObject(walkGround,false)[0];
    if(hit){
      if(outNormal&&hit.face){
        groundNormalMatrix.getNormalMatrix(walkGround.matrixWorld);
        outNormal.copy(hit.face.normal).applyNormalMatrix(groundNormalMatrix).normalize();
      }
      return hit.point.y;
    }
  }
  if(outNormal)surfaceUp(x,z,outNormal);
  return terrainHeight(x,z);
}
function surfaceUp(x,z,out=new THREE.Vector3()){
  if(usingRealBennu()){
    const e=.22,hL=nightingaleHeight(x-e,z),hR=nightingaleHeight(x+e,z),hD=nightingaleHeight(x,z-e),hU=nightingaleHeight(x,z+e);
    out.set(-(hR-hL)/(2*e),1,-(hU-hD)/(2*e)).normalize();return out;
  }
  const R=world.radius,cy=curvatureHeight(x,z)+R;
  out.set(x,cy,z).normalize();return out;
}
function horizonDistance(){return Math.sqrt(2*world.radius*EYE_HEIGHT+EYE_HEIGHT*EYE_HEIGHT)}

function makeStars(){
  const rng=mulberry32(9941),count=1800;
  const g=new THREE.BufferGeometry(),arr=new Float32Array(count*3);
  for(let i=0;i<count;i++){
    const r=2500+rng()*2400,th=rng()*Math.PI*2,ph=Math.acos(2*rng()-1);
    arr[i*3]=r*Math.sin(ph)*Math.cos(th);arr[i*3+1]=r*Math.cos(ph);arr[i*3+2]=r*Math.sin(ph)*Math.sin(th);
  }
  g.setAttribute('position',new THREE.BufferAttribute(arr,3));
  const m=new THREE.PointsMaterial({color:0xe9edf0,size:qualityMode==='hd'?1:.72,sizeAttenuation:false,transparent:true,opacity:qualityMode==='hd'?.38:.28,depthWrite:false});
  starField=new THREE.Points(g,m);starField.geometry.setDrawRange(0,qualityMode==='hd'?count:620);scene.add(starField);
}
makeStars();

let cinematicSky=null;
function makeJupiterTexture(){
  const N=1024,c=document.createElement('canvas');c.width=c.height=N;
  const ctx=c.getContext('2d');
  ctx.clearRect(0,0,N,N);
  ctx.save();
  ctx.beginPath();ctx.arc(N/2,N/2,N*.48,0,Math.PI*2);ctx.clip();

  const base=ctx.createLinearGradient(0,0,0,N);
  base.addColorStop(0,'#d9c7aa');base.addColorStop(.22,'#b78d67');base.addColorStop(.45,'#e6d4ba');
  base.addColorStop(.66,'#9d6e4e');base.addColorStop(.82,'#d2b58e');base.addColorStop(1,'#7f604d');
  ctx.fillStyle=base;ctx.fillRect(0,0,N,N);

  const bands=[
    ['rgba(78,63,62,.55)',.12,.045],['rgba(239,225,202,.72)',.18,.035],
    ['rgba(121,86,67,.58)',.25,.055],['rgba(222,199,166,.72)',.33,.04],
    ['rgba(92,79,79,.46)',.39,.028],['rgba(232,218,195,.82)',.46,.052],
    ['rgba(132,82,58,.56)',.54,.075],['rgba(226,199,164,.65)',.63,.045],
    ['rgba(95,85,88,.50)',.70,.035],['rgba(222,194,160,.72)',.78,.055],
    ['rgba(116,79,63,.58)',.87,.07]
  ];
  bands.forEach(([color,yf,hf],i)=>{
    ctx.fillStyle=color;
    ctx.beginPath();
    const y0=N*yf,h=N*hf;
    ctx.moveTo(0,y0);
    for(let x=0;x<=N;x+=16){
      const wobble=Math.sin(x*.019+i*1.9)*N*.008+Math.sin(x*.049+i*.7)*N*.004;
      ctx.lineTo(x,y0+wobble);
    }
    for(let x=N;x>=0;x-=16){
      const wobble=Math.sin(x*.017+i*1.3)*N*.008+Math.sin(x*.043+i*.4)*N*.004;
      ctx.lineTo(x,y0+h+wobble);
    }
    ctx.closePath();ctx.fill();
  });

  const spot=ctx.createRadialGradient(N*.66,N*.62,4,N*.66,N*.62,N*.13);
  spot.addColorStop(0,'rgba(191,91,55,.95)');spot.addColorStop(.42,'rgba(166,74,47,.90)');
  spot.addColorStop(.72,'rgba(224,157,112,.62)');spot.addColorStop(1,'rgba(206,174,142,0)');
  ctx.save();ctx.translate(N*.66,N*.62);ctx.scale(1.65,.72);ctx.translate(-N*.66,-N*.62);
  ctx.fillStyle=spot;ctx.beginPath();ctx.arc(N*.66,N*.62,N*.14,0,Math.PI*2);ctx.fill();ctx.restore();

  for(let i=0;i<120;i++){
    const y=(i/120)*N,alpha=.018+.018*Math.sin(i*.7);
    ctx.fillStyle='rgba(255,255,255,'+Math.max(.005,alpha)+')';
    ctx.fillRect(0,y,N,1);
  }

  const shade=ctx.createRadialGradient(N*.38,N*.34,N*.12,N*.50,N*.50,N*.53);
  shade.addColorStop(0,'rgba(255,255,255,.20)');shade.addColorStop(.58,'rgba(255,255,255,0)');
  shade.addColorStop(.82,'rgba(0,0,0,.18)');shade.addColorStop(1,'rgba(0,0,0,.92)');
  ctx.fillStyle=shade;ctx.fillRect(0,0,N,N);
  ctx.restore();

  const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;
  tex.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
  return tex;
}
function makeCinematicSky(){
  const group=new THREE.Group();
  // A seamless celestial backdrop, with a warm, softly mottled Milky Way.
  const skyCanvas=document.createElement('canvas');skyCanvas.width=2048;skyCanvas.height=1024;
  const skyCtx=skyCanvas.getContext('2d'),rng=mulberry32(48127);
  skyCtx.fillStyle='#020304';skyCtx.fillRect(0,0,2048,1024);
  for(let i=0;i<700;i++){
    const x=rng()*2048,y=430+Math.sin(x/2048*Math.PI*2)*150+(rng()-.5)*150;
    const r=12+rng()*62,g=skyCtx.createRadialGradient(x,y,0,x,y,r);
    g.addColorStop(0,'rgba(130,108,78,.025)');g.addColorStop(1,'rgba(60,53,47,0)');
    skyCtx.fillStyle=g;skyCtx.fillRect(x-r,y-r,r*2,r*2);
  }
  for(let i=0;i<11000;i++){
    const x=rng()*2048,y=rng()*1024,bright=rng(),r=bright>.996?1.5:bright>.95?.8:.35;
    const band=Math.abs(y-(430+Math.sin(x/2048*Math.PI*2)*150))<85;
    skyCtx.globalAlpha=(band?.45:.25)+rng()*.45;skyCtx.fillStyle=bright>.88?'#e8d9bd':'#b6bdc5';
    skyCtx.beginPath();skyCtx.arc(x,y,r,0,Math.PI*2);skyCtx.fill();
  }
  skyCtx.globalAlpha=1;
  const skyTex=new THREE.CanvasTexture(skyCanvas);skyTex.colorSpace=THREE.SRGBColorSpace;skyTex.wrapS=THREE.RepeatWrapping;
  const backdrop=new THREE.Mesh(new THREE.SphereGeometry(9000,48,24),new THREE.MeshBasicMaterial({map:skyTex,side:THREE.BackSide,depthWrite:false,toneMapped:false}));
  backdrop.renderOrder=-10;group.add(backdrop);
  const haloCanvas=document.createElement('canvas');haloCanvas.width=haloCanvas.height=512;
  const hctx=haloCanvas.getContext('2d'),hg=hctx.createRadialGradient(256,256,135,256,256,250);
  hg.addColorStop(0,'rgba(255,224,190,.16)');hg.addColorStop(.72,'rgba(255,210,165,.06)');hg.addColorStop(1,'rgba(255,200,150,0)');
  hctx.fillStyle=hg;hctx.fillRect(0,0,512,512);
  const haloTex=new THREE.CanvasTexture(haloCanvas);
  const halo=new THREE.Sprite(new THREE.SpriteMaterial({map:haloTex,transparent:true,depthWrite:false,opacity:.58}));
  halo.position.set(-780,900,-3225);halo.scale.set(1160,1160,1);halo.renderOrder=-3;

  const planetMat=new THREE.SpriteMaterial({map:makeJupiterTexture(),transparent:true,depthWrite:true,alphaTest:.02,toneMapped:false});
  planetMat.onBeforeCompile=shader=>{
    shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>','#include <map_fragment>\n diffuseColor.a *= smoothstep(0.008,0.045,max(diffuseColor.r,max(diffuseColor.g,diffuseColor.b)));');
  };
  const planet=new THREE.Sprite(planetMat);
  new THREE.TextureLoader().load('./assets/jupiter_reference.png',tex=>{tex.colorSpace=THREE.SRGBColorSpace;tex.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());planetMat.map=tex;planetMat.needsUpdate=true;});
  planet.position.set(-780,855,-3150);planet.scale.set(1650,928,1);planet.renderOrder=-2;
  group.add(halo,planet);group.visible=false;scene.add(group);return group;
}
cinematicSky=makeCinematicSky();

function makeSunSprite(){
  const c=document.createElement('canvas');c.width=c.height=256;const ctx=c.getContext('2d');
  const gr=ctx.createRadialGradient(128,128,2,128,128,128);
  gr.addColorStop(0,'rgba(255,255,255,1)');gr.addColorStop(.06,'rgba(255,251,235,1)');gr.addColorStop(.11,'rgba(255,244,210,.72)');gr.addColorStop(.22,'rgba(255,235,190,.14)');gr.addColorStop(1,'rgba(255,230,190,0)');
  ctx.fillStyle=gr;ctx.fillRect(0,0,256,256);
  const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;
  const mat=new THREE.SpriteMaterial({map:tex,transparent:true,depthWrite:false,opacity:.9});
  const sp=new THREE.Sprite(mat);sp.scale.set(38,38,1);scene.add(sp);return sp;
}
const sunSprite=makeSunSprite();
function positionSun(){
  const dir=new THREE.Vector3(-.56,.34,.76).normalize();
  const lightRange=Math.max(1600,Math.max(...orbitAxes().toArray())*8);
  sun.position.copy(dir).multiplyScalar(lightRange);sun.target.position.set(0,-10,0);
  sunSprite.position.copy(dir).multiplyScalar(lightRange*2.2);sunSprite.scale.setScalar(Math.max(38,Math.max(...orbitAxes().toArray())*.15));
  const span=world.terrainSize*.58;
  sun.shadow.camera.left=-span;sun.shadow.camera.right=span;sun.shadow.camera.top=span;sun.shadow.camera.bottom=-span;sun.shadow.camera.updateProjectionMatrix();
}

function disposeGroup(group){
  while(group.children.length){const o=group.children.pop();o.traverse?.(c=>{if(!c.userData.keepGeometry)c.geometry?.dispose?.();if(c.material){(Array.isArray(c.material)?c.material:[c.material]).forEach(m=>{m.map?.dispose?.();m.bumpMap?.dispose?.();m.dispose?.()})}})}
}
function irregularRockGeometry(detail=1,seed=1){
  const g=new THREE.IcosahedronGeometry(1,detail);const p=g.attributes.position;const v=new THREE.Vector3();
  for(let i=0;i<p.count;i++){
    v.fromBufferAttribute(p,i);const d=v.clone().normalize();
    const n=.78+noise(d.x*3.8+seed,d.z*3.8-seed,seed)*.19+noise(d.y*8.2,d.x*7.4,seed+7)*.08;
    v.copy(d).multiplyScalar(n);p.setXYZ(i,v.x,v.y,v.z);
  }
  const merged=mergeVertices(g,1e-4);merged.computeVertexNormals();g.dispose();return merged;
}
function asteroidRock(radius,detail,color,kind){
  const g=new THREE.IcosahedronGeometry(radius,detail),p=g.attributes.position,v=new THREE.Vector3();
  for(let i=0;i<p.count;i++){
    v.fromBufferAttribute(p,i);const d=v.clone().normalize(),r=v.length();
    let n=noise(d.x*8,d.z*8,37+d.y*4)*.085+noise(d.y*18,d.x*15,19)*.025;
    if(kind==='bennu') n+=Math.exp(-Math.pow(d.y*2.4,2))*.11;
    v.copy(d).multiplyScalar(r*(1+n));p.setXYZ(i,v.x,v.y,v.z);
  }
  const merged=mergeVertices(g,1e-4);merged.computeVertexNormals();g.dispose();
  const m=new THREE.MeshStandardMaterial({color,roughness:.98,metalness:kind==='kleopatra'?.2:.015});
  const mesh=new THREE.Mesh(merged,m);mesh.castShadow=true;mesh.receiveShadow=true;return mesh;
}

function orbitAxes(){
  if(selectedKey==='bennu')return new THREE.Vector3(286,255,281);
  if(selectedKey==='eros')return new THREE.Vector3(16500,6500,6500);
  return new THREE.Vector3(135000,47000,40500);
}
let orbitalBennuGeometry=null,orbitalBennuPromise=null,orbitBodyGeneration=0;
function loadOrbitalBennu(){
  if(orbitalBennuGeometry)return Promise.resolve(orbitalBennuGeometry);
  if(orbitalBennuPromise)return orbitalBennuPromise;
  orbitalBennuPromise=new Promise((resolve,reject)=>{
    new GLTFLoader().load('./assets/bennu_global_lod.glb',gltf=>{
      try{
        gltf.scene.updateMatrixWorld(true);let source;gltf.scene.traverse(o=>{if(!source&&o.isMesh)source=o;});
        if(!source)throw new Error('Missing orbital Bennu mesh');
        let g=source.geometry;g.applyMatrix4(source.matrixWorld);g.computeVertexNormals();const expanded=g.toNonIndexed();g.dispose();g=expanded;
        const p=g.attributes.position,uv=new Float32Array(p.count*2);
        for(let i=0;i<p.count;i++){const x=p.getX(i),y=p.getY(i),z=p.getZ(i),r=Math.hypot(x,y,z);uv[i*2]=.5+Math.atan2(-z,x)/(Math.PI*2);uv[i*2+1]=.5+Math.asin(THREE.MathUtils.clamp(y/r,-1,1))/Math.PI;}
        // Duplicate triangle vertices allow longitude seams without stretching the mosaic.
        for(let i=0;i<p.count;i+=3){const a=uv[i*2],b=uv[(i+1)*2],c=uv[(i+2)*2];if(Math.max(a,b,c)-Math.min(a,b,c)>.5)for(let k=0;k<3;k++)if(uv[(i+k)*2]<.5)uv[(i+k)*2]+=1;}
        g.setAttribute('uv',new THREE.BufferAttribute(uv,2));g.computeBoundingSphere();orbitalBennuGeometry=g;resolve(g);
      }catch(err){orbitalBennuPromise=null;reject(err);}
    },undefined,err=>{orbitalBennuPromise=null;reject(err);});
  });return orbitalBennuPromise;
}
function buildOrbitBody(){
  const generation=++orbitBodyGeneration;
  disposeGroup(orbitGroup);
  if(selectedKey==='bennu'){
    if(orbitalBennuGeometry){
      const texture=new THREE.TextureLoader().load('./assets/bennu_global_albedo.jpg');texture.colorSpace=THREE.SRGBColorSpace;texture.wrapS=THREE.RepeatWrapping;texture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
      const material=new THREE.MeshStandardMaterial({color:0xbcbcbc,map:texture,roughness:1,metalness:0});
      const mesh=new THREE.Mesh(orbitalBennuGeometry,material);mesh.userData.keepGeometry=true;mesh.receiveShadow=true;mesh.castShadow=!isTouch;orbitGroup.add(mesh);orbitGroup.visible=true;return;
    }
    loadOrbitalBennu().then(()=>{if(generation===orbitBodyGeneration&&selectedKey==='bennu'&&orbitGroup.visible)buildOrbitBody();}).catch(err=>console.warn('Orbital NASA model unavailable; keeping immediate preview:',err));
  }
  const axes=orbitAxes(),seed=world.seed;
  const makeLobe=(scale,position,detail=6)=>{
    const g=new THREE.IcosahedronGeometry(1,detail),p=g.attributes.position,cols=new Float32Array(p.count*3),v=new THREE.Vector3();
    for(let i=0;i<p.count;i++){
      v.fromBufferAttribute(p,i);const d=v.clone().normalize();
      const broad=noise(d.x*5+seed,d.z*5-seed,seed)*.035;
      const crag=noise(d.y*12+seed,d.x*11,seed+71)*.012;
      const chipped=Math.sign(noise(d.z*18,d.y*16,seed+131))*.003;
      v.copy(d).multiplyScalar(1+broad+crag+chipped);p.setXYZ(i,v.x,v.y,v.z);
      const shade=THREE.MathUtils.clamp(.72+noise(d.x*12,d.z*12,seed+313)*.18+noise(d.y*32,d.x*28,seed+919)*.09,.48,1);
      cols[i*3]=shade;cols[i*3+1]=shade*.99;cols[i*3+2]=shade*.97;
    }
    g.setAttribute('color',new THREE.BufferAttribute(cols,3));const smooth=mergeVertices(g,1e-5);g.dispose();smooth.computeVertexNormals();
    const mat=new THREE.MeshStandardMaterial({color:world.color,vertexColors:true,roughness:1,metalness:selectedKey==='kleopatra'?.16:0});
    const mesh=new THREE.Mesh(smooth,mat);mesh.scale.copy(scale);mesh.position.copy(position);mesh.castShadow=true;mesh.receiveShadow=true;orbitGroup.add(mesh);
  };
  if(selectedKey==='kleopatra'){
    makeLobe(new THREE.Vector3(61000,44000,39000),new THREE.Vector3(-42000,0,0));
    makeLobe(new THREE.Vector3(61000,44000,39000),new THREE.Vector3(42000,0,0));
    makeLobe(new THREE.Vector3(50000,20500,23000),new THREE.Vector3(0,0,0),4);
  }else makeLobe(axes,new THREE.Vector3());
  if(selectedKey==='bennu'){orbitGroup.visible=true;return;}
  const rng=mulberry32(seed+711),rockGeo=new THREE.IcosahedronGeometry(1,1),rockMat=new THREE.MeshStandardMaterial({color:0x343637,roughness:1,flatShading:true});
  const count=isTouch?220:520,rocks=new THREE.InstancedMesh(rockGeo,rockMat,count),dummy=new THREE.Object3D();
  const characteristic=Math.max(axes.x,axes.y,axes.z),minSize=characteristic*(selectedKey==='bennu'?.003:.002),maxSize=characteristic*(selectedKey==='bennu'?.012:.009);
  for(let i=0;i<count;i++){
    const y=rng()*2-1,theta=rng()*Math.PI*2,q=Math.sqrt(1-y*y),nx=q*Math.cos(theta),ny=y,nz=q*Math.sin(theta);
    const size=minSize+Math.pow(rng(),2.4)*(maxSize-minSize),normal=new THREE.Vector3(nx/axes.x,ny/axes.y,nz/axes.z).normalize();
    dummy.position.set(nx*axes.x,ny*axes.y,nz*axes.z).addScaledVector(normal,size*.48);
    dummy.quaternion.setFromUnitVectors(Y_AXIS,normal);dummy.rotateY(rng()*Math.PI*2);
    dummy.scale.set(size*(.65+rng()*.75),size*(.45+rng()*.55),size*(.6+rng()*.75));dummy.updateMatrix();rocks.setMatrixAt(i,dummy.matrix);
  }
  rocks.instanceMatrix.needsUpdate=true;rocks.castShadow=true;orbitGroup.add(rocks);
  const largeCount=selectedKey==='kleopatra'?0:(isTouch?140:300);
  if(largeCount){
    const largeGeo=new THREE.IcosahedronGeometry(1,2),largeMat=new THREE.MeshStandardMaterial({color:0x464748,roughness:1,flatShading:true}),large=new THREE.InstancedMesh(largeGeo,largeMat,largeCount);
    for(let i=0;i<largeCount;i++){
      const y=rng()*2-1,theta=rng()*Math.PI*2,q=Math.sqrt(1-y*y),nx=q*Math.cos(theta),ny=y,nz=q*Math.sin(theta);
      const size=characteristic*(.018+rng()*.052),normal=new THREE.Vector3(nx/axes.x,ny/axes.y,nz/axes.z).normalize();
      dummy.position.set(nx*axes.x,ny*axes.y,nz*axes.z).addScaledVector(normal,size*.52);dummy.quaternion.setFromUnitVectors(Y_AXIS,normal);dummy.rotateY(rng()*Math.PI*2);
      dummy.scale.set(size*(.65+rng()*.8),size*(.5+rng()*.6),size*(.62+rng()*.72));dummy.updateMatrix();large.setMatrixAt(i,dummy.matrix);
    }
    large.instanceMatrix.needsUpdate=true;large.castShadow=true;orbitGroup.add(large);
  }
  orbitGroup.visible=true;
}

function buildPreview(){
  // The landing screen uses the NASA rotation GIF instead of a procedural rock.
  disposeGroup(previewGroup);previewGroup.visible=false;positionSun();
}

function surfaceTexture(){
  if(selectedKey==='bennu'){
    const tex=new THREE.TextureLoader().load(usingRealBennu()?'./assets/nightingale_albedo.jpg':'./assets/bennu_patch.jpg');
    tex.wrapS=tex.wrapT=THREE.ClampToEdgeWrapping;
    tex.colorSpace=THREE.SRGBColorSpace;
    tex.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
    return tex;
  }
  const N=qualityMode==='hd'?1024:512,c=document.createElement('canvas');c.width=c.height=N;const ctx=c.getContext('2d'),img=ctx.createImageData(N,N),d=img.data;
  const base=new THREE.Color(world.color);const br=base.r*255,bg=base.g*255,bb=base.b*255;
  for(let y=0;y<N;y++)for(let x=0;x<N;x++){
    const i=(y*N+x)*4,coarse=noise(x/34,y/34,world.seed)*19,fine=hash2(x,y,world.seed)*10,fleck=Math.abs(hash2(x*3,y*7,world.seed+9))>.985?22:0,k=coarse+fine+fleck;
    d[i]=THREE.MathUtils.clamp(br+k,4,180);d[i+1]=THREE.MathUtils.clamp(bg+k*.96,4,180);d[i+2]=THREE.MathUtils.clamp(bb+k*.92,4,180);d[i+3]=255;
  }
  ctx.putImageData(img,0,0);const tex=new THREE.CanvasTexture(c);tex.wrapS=tex.wrapT=THREE.RepeatWrapping;tex.repeat.set(16,16);tex.colorSpace=THREE.SRGBColorSpace;tex.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());return tex;
}

function bennuMicroBumpTexture(){
  const N=qualityMode==='hd'?1024:512,c=document.createElement('canvas');c.width=c.height=N;const ctx=c.getContext('2d'),img=ctx.createImageData(N,N),d=img.data;
  for(let y=0;y<N;y++)for(let x=0;x<N;x++){
    const i=(y*N+x)*4;
    const coarse=noise(x/10.5,y/10.5,813)*32;
    const fine=noise(x/2.15,y/2.15,997)*19;
    const grit=Math.abs(hash2(x*7,y*11,1201))>.91?48:0;
    const v=THREE.MathUtils.clamp(128+coarse+fine+grit,18,238);
    d[i]=d[i+1]=d[i+2]=v;d[i+3]=255;
  }
  ctx.putImageData(img,0,0);
  const tex=new THREE.CanvasTexture(c);tex.wrapS=tex.wrapT=THREE.RepeatWrapping;tex.repeat.set(12,12);tex.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());return tex;
}

function fracturedRockGeometry(detail=1,seed=1){
  const g=new THREE.IcosahedronGeometry(1,detail),p=g.attributes.position,v=new THREE.Vector3();
  for(let i=0;i<p.count;i++){
    v.fromBufferAttribute(p,i);const d=v.clone().normalize();
    const broad=noise(d.x*3.1+seed,d.z*3.7-seed,seed)*.20;
    const chip=noise(d.y*8.7+seed,d.x*9.4,seed+71)*.10;
    const ridge=Math.sign(noise(d.z*13,d.y*11,seed+131))*.035;
    v.copy(d).multiplyScalar(THREE.MathUtils.clamp(.79+broad+chip+ridge,.50,1.10));
    p.setXYZ(i,v.x,v.y,v.z);
  }
  const merged=mergeVertices(g,1e-4);merged.computeVertexNormals();g.dispose();return merged;
}

function addRockInstance(mesh,dummy,x,z,s,rx,ry,rz,angular=false){
  surfaceUp(x,z,tmpUp);dummy.position.set(x,terrainHeight(x,z),z).addScaledVector(tmpUp,s*(angular?.24:.34));
  tmpQUp.setFromUnitVectors(Y_AXIS,tmpUp);tmpQLook.setFromEuler(new THREE.Euler(rx,ry,rz));dummy.quaternion.copy(tmpQUp).multiply(tmpQLook);
  const ax=angular?.48:.72,ay=angular?.30:.52,az=angular?.44:.68;
  dummy.scale.set(s*(ax+Math.abs(Math.sin(ry))*.62),s*(ay+Math.abs(Math.cos(rx))*.52),s*(az+Math.abs(Math.sin(rz+1))*.58));dummy.updateMatrix();mesh.setMatrixAt(mesh.userData.index++,dummy.matrix);
}

function buildTerrain(){
  walkGround=null;disposeGroup(terrainGroup);positionSun();
  const real=usingRealBennu(),m=real?nightingale.meta:null;
  const sizeX=real?m.width:world.terrainSize,sizeZ=real?m.depth:world.terrainSize;
  if(real&&qualityMode==='hd'&&nightingaleGeometry){
    const tex=surfaceTexture(),microBump=bennuMicroBumpTexture();
    const mat=new THREE.MeshStandardMaterial({map:tex,bumpMap:microBump,bumpScale:.075,roughness:1,metalness:0,color:0xc8c8c8});
    const ground=new THREE.Mesh(nightingaleGeometry,mat);
    ground.receiveShadow=true;ground.castShadow=!isTouch;ground.userData.keepGeometry=true;
    terrainGroup.add(ground);terrainGroup.visible=false;return;
  }
  const segX=real?(qualityMode==='hd'?(isTouch?192:320):(isTouch?160:255)):(qualityMode==='hd'?(isTouch?140:220):(isTouch?115:175)),segZ=segX;
  const geo=new THREE.PlaneGeometry(sizeX,sizeZ,segX,segZ),pos=geo.attributes.position;
  for(let i=0;i<pos.count;i++){const x=pos.getX(i),z=-pos.getY(i);pos.setZ(i,terrainHeight(x,z)+(real?bennuVisualRoughness(x,z):0))}
  geo.computeVertexNormals();geo.rotateX(-Math.PI/2);
  const tex=surfaceTexture();
  const microBump=real?bennuMicroBumpTexture():tex;
  const mat=new THREE.MeshStandardMaterial({map:tex,bumpMap:microBump,bumpScale:real?.075:.35,roughness:1,metalness:selectedKey==='kleopatra'?.12:0,color:real?0xc8c8c8:0xffffff});
  const ground=new THREE.Mesh(geo,mat);ground.receiveShadow=true;ground.castShadow=true;terrainGroup.add(ground);

  const rng=mulberry32(world.seed),dummy=new THREE.Object3D();
  if(real){
    // Bennu is a rubble pile: keep the real Nightingale macro terrain, then add
    // several instanced debris scales so the near field resembles OSIRIS-REx imagery.
    const limX=sizeX*.485,limZ=sizeZ*.485;
    const makeLayer=(count,detail,seedOffset,sizeMin,sizeMax,power,baseColor,angular=true)=>{
      const variants=[];
      for(let v=0;v<3;v++){
        const g=fracturedRockGeometry(detail,world.seed+seedOffset+v*37);
        const shade=v===0?0.86:v===1?1.0:1.12;
        const rm=new THREE.MeshStandardMaterial({color:new THREE.Color(baseColor).multiplyScalar(shade),bumpMap:microBump.clone(),bumpScale:.012,roughness:1,metalness:0,flatShading:false});
        const inst=new THREE.InstancedMesh(g,rm,Math.ceil(count/3));inst.castShadow=true;inst.receiveShadow=true;inst.userData.index=0;variants.push(inst);terrainGroup.add(inst);
      }
      for(let i=0;i<count;i++){
        let x=(rng()-.5)*limX*2,z=(rng()-.5)*limZ*2;
        // Bias part of the debris toward the EVA start so the first 20 m have rich scale cues.
        if(i<count*.58){const a=rng()*Math.PI*2,r=Math.sqrt(rng())*Math.min(19,limX*.82,limZ*.82);x=Math.cos(a)*r;z=Math.sin(a)*r;}
        if(Math.hypot(x,z)<1.15){const a=rng()*Math.PI*2;x+=Math.cos(a)*(1.2+rng()*1.8);z+=Math.sin(a)*(1.2+rng()*1.8);}
        const s=sizeMin+Math.pow(rng(),power)*(sizeMax-sizeMin);
        addRockInstance(variants[i%3],dummy,x,z,s,rng()*2.5,rng()*Math.PI*2,rng()*2.5,angular);
      }
      variants.forEach(v=>{v.count=v.userData.index;v.instanceMatrix.needsUpdate=true});
    };

    // Pebbles and fist-size fragments. Geometry is deliberately simple and angular;
    // the NASA albedo + high-frequency bump provides the sub-centimetre gravel.
    makeLayer(isTouch?2400:4600,qualityMode==='hd'?(isTouch?1:2):1,200,.018,.16,2.2,0x555657,true);
    // Hand-to-football sized fragments, common in the reference imagery.
    makeLayer(isTouch?620:1500,qualityMode==='hd'?2:1,500,.10,.48,2.0,0x4a4b4c,true);
    // Sparse larger fragments that break the silhouette without inventing major terrain.
    makeLayer(isTouch?120:260,qualityMode==='hd'?(isTouch?2:3):(isTouch?1:2),800,.32,.90,1.65,0x444546,true);

    terrainGroup.visible=false;return;
  }

  const variants=[];
  for(let v=0;v<3;v++){
    const g=irregularRockGeometry(isTouch?2:3,world.seed+v*13),rm=new THREE.MeshStandardMaterial({color:world.rockColor,roughness:.98,metalness:selectedKey==='kleopatra'?.12:0});
    const smallCount=isTouch?Math.floor(world.smallBoulders*.55):world.smallBoulders,count=Math.ceil(smallCount/3),inst=new THREE.InstancedMesh(g,rm,count);inst.castShadow=true;inst.receiveShadow=true;inst.userData.index=0;variants.push(inst);terrainGroup.add(inst);
  }
  const limit=world.terrainSize*.43;
  for(let i=0;i<(isTouch?Math.floor(world.smallBoulders*.55):world.smallBoulders);i++){
    let x=(rng()-.5)*limit*2,z=(rng()-.5)*limit*2;if(Math.hypot(x,z)<4){x+=6+rng()*7;z-=5+rng()*6}const s=.28+Math.pow(rng(),3)*7.5;
    addRockInstance(variants[i%3],dummy,x,z,s,rng()*2,rng()*Math.PI*2,rng()*2);
  }
  variants.forEach(v=>{v.count=v.userData.index;v.instanceMatrix.needsUpdate=true});
  for(let i=0;i<world.largeBoulders;i++){
    let x=(rng()-.5)*limit*1.85,z=(rng()-.5)*limit*1.85;if(Math.hypot(x,z)<11){x+=18;z-=14}
    const max=selectedKey==='eros'?19:25,s=1.4+Math.pow(rng(),1.8)*max;
    const mesh=new THREE.Mesh(irregularRockGeometry(isTouch?3:4,world.seed+100+i),new THREE.MeshStandardMaterial({color:new THREE.Color(world.rockColor).multiplyScalar(.82+rng()*.25),roughness:1,metalness:selectedKey==='kleopatra'?.13:0}));
    surfaceUp(x,z,tmpUp);mesh.position.set(x,terrainHeight(x,z),z).addScaledVector(tmpUp,s*.31);tmpQUp.setFromUnitVectors(Y_AXIS,tmpUp);tmpQLook.setFromEuler(new THREE.Euler(rng()*1.6,rng()*6.28,rng()*1.6));mesh.quaternion.copy(tmpQUp).multiply(tmpQLook);mesh.scale.set(s*(.75+rng()*.7),s*(.52+rng()*.55),s*(.67+rng()*.65));mesh.castShadow=true;mesh.receiveShadow=true;terrainGroup.add(mesh);
  }
  terrainGroup.visible=false;
}

function cardHTML(key,w){return `<button class="card ${key===selectedKey?'active':''}" data-key="${key}"><img class="cardImage" src="${w.previewImage}" alt="${w.name} mission view"><span class="cardShade"></span><span class="cardSource">${w.previewSource}</span><span class="cardCopy"><strong>${w.name}</strong><span>${w.size}</span><small>${w.type}</small></span></button>`}
function renderCards(){cardsWrap.innerHTML=Object.entries(WORLDS).map(([k,w])=>cardHTML(k,w)).join('');cardsWrap.querySelectorAll('.card').forEach(el=>el.addEventListener('click',()=>selectWorld(el.dataset.key)))}
function selectWorld(key){selectedKey=key;world=WORLDS[key];renderCards();buildPreview();landBtn.textContent=`ENTER ${world.name} EVA`;updateHUD()}
function updateHUD(){
  $('#hudName').textContent=world.name;$('#evaWorld').textContent=world.name;$('#hudType').textContent=world.type;$('#hudGravity').textContent=world.gravityText;$('#hudEscape').textContent=world.escapeText;$('#hudSize').textContent=world.size;
  $('#horizonReadout').textContent=`EYE HORIZON ~${horizonDistance()<1000?horizonDistance().toFixed(0)+' m':(horizonDistance()/1000).toFixed(1)+' km'}`;
}

function showLanding(){
  orbitTransition=null;orbitLighting(false);
  mode='landing';ambient.intensity=.07;document.exitPointerLock?.();landing.classList.remove('hidden');hud.classList.add('hidden');hud.classList.remove('orbitMode');science.classList.add('hidden');visor.classList.add('hidden');escapeOverlay.classList.add('hidden');terrainGroup.visible=false;orbitGroup.visible=false;previewGroup.visible=true;if(cinematicSky)cinematicSky.visible=false;
  camera.position.set(0,28,230);camera.up.set(0,1,0);camera.lookAt(35,5,0);renderer.toneMappingExposure=.95;
}
async function startWalk(){
  if(selectedKey==='bennu'&&!nightingale.ready&&nightingale.promise){
    const original=landBtn.textContent;landBtn.disabled=true;landBtn.textContent='LOADING NASA TERRAIN...';await nightingale.promise;landBtn.disabled=false;landBtn.textContent=original;
  }
  // Start on the lightweight terrain; a large HD download must never block entry.
  if(selectedKey==='bennu'&&usingRealBennu()&&qualityMode==='hd'&&!nightingaleGeometry){
    loadNightingaleGeometry().then(()=>{
      if(mode==='walk'&&selectedKey==='bennu'&&qualityMode==='hd'){
        buildTerrain();terrainGroup.visible=true;updateCamera();
      }
    }).catch(err=>console.warn('HD mesh unavailable; keeping lightweight terrain:',err));
  }
  mode='walk';ambient.intensity=.34;buildTerrain();previewGroup.visible=false;orbitGroup.visible=false;terrainGroup.visible=true;if(cinematicSky)cinematicSky.visible=true;landing.classList.add('hidden');hud.classList.remove('hidden');hud.classList.remove('orbitMode');$('#hudEscape').previousElementSibling.textContent='ESCAPE';$('#hudEscape').textContent=world.escapeText;$('#orbitBtn').textContent='ORBIT';$('#desktopHint').textContent='CLICK TO LOOK · WASD CAREFUL TRAVERSE · SPACE PUSH OFF';science.classList.add('hidden');visor.classList.remove('hidden');escapeOverlay.classList.add('hidden');renderer.toneMappingExposure=1.28;
  let sx=0,sz=0;if(usingRealBennu()){const m=nightingale.meta;sx=m.landingStartXZ[0]-m.cx;sz=m.landingStartXZ[1]-m.cz}
  player={x:sx,z:sz,yaw:.25,pitch:.14,jumpY:0,vY:0,distance:0,escaping:false,escapeLift:0,escapeTimer:0,bob:0,moving:false};$('#hudName').previousElementSibling.textContent='SURFACE';updateHUD();updateCamera();
}
function updateCamera(){
  const h=terrainHeight(player.x,player.z);surfaceUp(player.x,player.z,tmpUp);tmpBase.set(player.x,h,player.z);
  const bobY=player.moving&&player.jumpY===0?Math.sin(player.bob)*.011:0;
  camera.position.copy(tmpBase).addScaledVector(tmpUp,EYE_HEIGHT+player.jumpY+player.escapeLift+bobY);
  tmpQUp.setFromUnitVectors(Y_AXIS,tmpUp);tmpEuler.set(player.pitch,player.yaw,0,'YXZ');tmpQLook.setFromEuler(tmpEuler);camera.quaternion.copy(tmpQUp).multiply(tmpQLook);
}
function orbitLighting(active){
  positionSun();
  const axes=orbitAxes(),span=active?Math.max(...axes.toArray())*1.24:world.terrainSize*.58;
  sun.shadow.camera.left=-span;sun.shadow.camera.right=span;sun.shadow.camera.top=span;sun.shadow.camera.bottom=-span;
  sun.shadow.camera.far=active?Math.max(4200,Math.max(...axes.toArray())*20):4200;
  sun.shadow.camera.updateProjectionMatrix();sun.target.position.set(0,active?0:-10,0);
  renderer.toneMappingExposure=active?1.10:.98;
  if(!active&&starField){starField.position.set(0,0,0);starField.scale.setScalar(1)}
}
function updateOrbitCamera(){
  camera.position.copy(orbitPos);
  if(orbitTransition){
    const t=THREE.MathUtils.clamp(orbitTransition.elapsed/orbitTransition.duration,0,1),e=t*t*(3-2*t);
    camera.quaternion.slerpQuaternions(orbitTransition.fromQuaternion,orbitTransition.toQuaternion,e);
  }else{tmpEuler.set(orbitPitch,orbitYaw,0,'YXZ');camera.quaternion.setFromEuler(tmpEuler)}
  if(starField){starField.position.copy(orbitPos);starField.scale.setScalar(Math.max(1,Math.max(...orbitAxes().toArray())/246))}
}
function enterOrbit(){
  if(mode!=='walk')return;
  savedSurface={x:player.x,z:player.z,yaw:player.yaw,pitch:player.pitch,distance:player.distance};
  buildOrbitBody();const axes=orbitAxes();
  orbitPos.set(player.x,axes.y+terrainHeight(player.x,player.z)+EYE_HEIGHT,player.z);
  // An oblique pass on the sunlit side keeps surface detail and the curved limb in view.
  const from=orbitPos.clone(),viewDirection=new THREE.Vector3(-.48,.52,.71).normalize();
  const to=new THREE.Vector3(viewDirection.x*axes.x,viewDirection.y*axes.y,viewDirection.z*axes.z).multiplyScalar(1.78);
  const fromQuaternion=camera.quaternion.clone(),lookCamera=camera.clone();
  lookCamera.position.copy(to);lookCamera.up.set(0,1,0);lookCamera.lookAt(0,axes.y*.24,0);
  const toQuaternion=lookCamera.quaternion.clone(),lookEuler=new THREE.Euler().setFromQuaternion(toQuaternion,'YXZ');
  orbitYaw=lookEuler.y;orbitPitch=lookEuler.x;
  orbitTransition={from,to,fromQuaternion,toQuaternion,elapsed:0,duration:2.2};ambient.intensity=.07;orbitLighting(true);
  mode='orbit';terrainGroup.visible=false;previewGroup.visible=false;orbitGroup.visible=true;if(cinematicSky)cinematicSky.visible=false;hud.classList.add('orbitMode');$('#hudName').previousElementSibling.textContent='ORBIT';$('#hudEscape').previousElementSibling.textContent='FLIGHT SPEED';$('#hudEscape').textContent=(Math.max(...axes.toArray())*.12).toFixed(0)+' m/s';$('#orbitBtn').textContent='LAND';$('#horizonReadout').textContent='FREE-FLIGHT MODE';$('#desktopHint').textContent='WASD / JOYSTICK TO FLY · DRAG TO LOOK · SHIFT BOOST';
  updateOrbitCamera();
}
function leaveOrbit(){
  if(mode!=='orbit')return;
  const s=savedSurface;mode='walk';ambient.intensity=.34;orbitTransition=null;orbitLighting(false);orbitGroup.visible=false;terrainGroup.visible=true;if(cinematicSky)cinematicSky.visible=true;hud.classList.remove('orbitMode');$('#hudEscape').previousElementSibling.textContent='ESCAPE';$('#hudEscape').textContent=world.escapeText;$('#orbitBtn').textContent='ORBIT';$('#desktopHint').textContent='CLICK TO LOOK · WASD CAREFUL TRAVERSE · SPACE PUSH OFF';updateHUD();$('#hudName').previousElementSibling.textContent='SURFACE';
  if(s){player.x=s.x;player.z=s.z;player.yaw=s.yaw;player.pitch=s.pitch;player.distance=s.distance;player.jumpY=0;player.vY=0;player.escaping=false}
  updateCamera();
}
function orbitMovement(dt){
  if(orbitTransition){orbitTransition.elapsed+=dt;const t=THREE.MathUtils.clamp(orbitTransition.elapsed/orbitTransition.duration,0,1),e=t*t*(3-2*t);orbitPos.lerpVectors(orbitTransition.from,orbitTransition.to,e);if(t>=1)orbitTransition=null;return}
  let forward=0,side=0;if(keys.has('KeyW')||keys.has('ArrowUp'))forward++;if(keys.has('KeyS')||keys.has('ArrowDown'))forward--;if(keys.has('KeyD')||keys.has('ArrowRight'))side++;if(keys.has('KeyA')||keys.has('ArrowLeft'))side--;forward+=-joy.y;side+=joy.x;
  const mag=Math.hypot(forward,side);if(mag>1){forward/=mag;side/=mag}if(mag<.04)return;
  const axes=orbitAxes(),speed=Math.max(...axes.toArray())*.12*(keys.has('ShiftLeft')||keys.has('ShiftRight')?2.2:1);
  const cp=Math.cos(orbitPitch),fwd=new THREE.Vector3(-Math.sin(orbitYaw)*cp,Math.sin(orbitPitch),-Math.cos(orbitYaw)*cp),right=new THREE.Vector3(Math.cos(orbitYaw),0,-Math.sin(orbitYaw));
  orbitPos.addScaledVector(fwd,forward*speed*dt).addScaledVector(right,side*speed*dt);
  const radial=Math.sqrt((orbitPos.x/axes.x)**2+(orbitPos.y/axes.y)**2+(orbitPos.z/axes.z)**2);
  if(radial<1.045)orbitPos.multiplyScalar(1.045/radial);
}
function jump(){if(mode!=='walk'||player.escaping||player.jumpY>.01)return;player.vY=world.jumpSpeed}
function escapeTest(){if(mode!=='walk'||player.escaping)return;player.escaping=true;player.escapeTimer=0;player.vY=world.escape*1.04/world.timeScale;$('#escapeWorld').textContent=world.name[0]+world.name.slice(1).toLowerCase();$('#escapeCopy').textContent=`A push above roughly ${world.escapeText.replace('~','')} is enough to escape this body's gravity.`}
function returnToSurface(){escapeOverlay.classList.add('hidden');player.escaping=false;player.escapeLift=0;player.jumpY=0;player.vY=0;if(usingRealBennu()){const m=nightingale.meta;player.x=m.landingStartXZ[0]-m.cx;player.z=m.landingStartXZ[1]-m.cz}else{player.x=0;player.z=0}updateCamera()}

function movement(dt){
  if(mode!=='walk'||player.escaping)return;
  let forward=0,side=0;if(keys.has('KeyW')||keys.has('ArrowUp'))forward++;if(keys.has('KeyS')||keys.has('ArrowDown'))forward--;if(keys.has('KeyD')||keys.has('ArrowRight'))side++;if(keys.has('KeyA')||keys.has('ArrowLeft'))side--;forward+=-joy.y;side+=joy.x;
  const mag=Math.hypot(forward,side);if(mag>1){forward/=mag;side/=mag}player.moving=mag>.05;
  const speed=world.walkSpeed*(keys.has('ShiftLeft')?1.35:1),dx=(Math.sin(player.yaw)*forward+Math.cos(player.yaw)*side)*speed*dt,dz=(-Math.cos(player.yaw)*forward+Math.sin(player.yaw)*side)*speed*dt;
  const nx=player.x+dx,nz=player.z+dz;let allowed=false;
  if(usingRealBennu()){
    const m=nightingale.meta,margin=2.2,inside=Math.abs(nx)<m.width/2-margin&&Math.abs(nz)<m.depth/2-margin;
    const step=Math.max(.001,Math.hypot(dx,dz)),dh=Math.abs(terrainHeight(nx,nz)-terrainHeight(player.x,player.z));allowed=inside&&dh<step*1.15+.025;
  }else{
    const limit=Math.min(world.terrainSize*.38,world.radius*.64);allowed=Math.hypot(nx,nz)<limit;
  }
  if(allowed){player.distance+=Math.hypot(dx,dz);player.x=nx;player.z=nz}
  if(player.moving)player.bob+=dt*5.1;
}
function physics(dt){
  if(mode!=='walk')return;if(player.escaping){player.escapeTimer+=dt;player.escapeLift+=(1.5+player.escapeTimer*4.2)*dt;if(player.escapeTimer>2.1)escapeOverlay.classList.remove('hidden');return}
  if(player.jumpY>0||player.vY>0){const pdt=dt*world.timeScale;player.jumpY+=player.vY*pdt;player.vY-=world.gravity*pdt;if(player.jumpY<=0){player.jumpY=0;player.vY=0}}
}
function updateReadouts(){if(mode==='walk'){$('#distanceReadout').textContent=`TRAVERSE ${player.distance<1000?player.distance.toFixed(0)+' m':(player.distance/1000).toFixed(2)+' km'}`;$('#altitudeReadout').textContent=`BOOT ALT +${(player.jumpY+player.escapeLift).toFixed(1)} m`}else if(mode==='orbit'){const a=orbitAxes(),rho=Math.sqrt((orbitPos.x/a.x)**2+(orbitPos.y/a.y)**2+(orbitPos.z/a.z)**2),alt=Math.max(0,(rho-1)*(a.x+a.y+a.z)/3);$('#distanceReadout').textContent=`ORBIT ${world.name}`;$('#altitudeReadout').textContent=`ALT ${alt<1000?alt.toFixed(0)+' m':(alt/1000).toFixed(1)+' km'}`}}

window.addEventListener('keydown',e=>{keys.add(e.code);if(e.code==='Space'){e.preventDefault();jump()}if(e.code==='KeyE')escapeTest();if(e.code==='Escape'&&(mode==='walk'||mode==='orbit'))showLanding()});window.addEventListener('keyup',e=>keys.delete(e.code));
canvas.addEventListener('click',()=>{if((mode==='walk'||mode==='orbit')&&!isTouch)canvas.requestPointerLock?.()});document.addEventListener('mousemove',e=>{if((mode==='walk'||mode==='orbit')&&document.pointerLockElement===canvas){if(mode==='orbit'){orbitYaw-=e.movementX*.00165;orbitPitch=THREE.MathUtils.clamp(orbitPitch-e.movementY*.00165,-1.48,1.48)}else{player.yaw-=e.movementX*.00165;player.pitch-=e.movementY*.00165;player.pitch=THREE.MathUtils.clamp(player.pitch,-1.42,1.42)}}});

const joystick=$('#joystick'),stick=$('#stick'),lookZone=$('#lookZone');
function setJoy(e){const r=joystick.getBoundingClientRect(),t=[...e.touches].find(t=>t.identifier===joy.id);if(!t)return;let x=(t.clientX-(r.left+r.width/2))/(r.width*.34),y=(t.clientY-(r.top+r.height/2))/(r.height*.34);const m=Math.hypot(x,y);if(m>1){x/=m;y/=m}joy.x=x;joy.y=y;stick.style.transform=`translate(${x*32}px,${y*32}px)`}
joystick.addEventListener('touchstart',e=>{joy.id=e.changedTouches[0].identifier;setJoy(e)},{passive:false});joystick.addEventListener('touchmove',e=>{e.preventDefault();setJoy(e)},{passive:false});joystick.addEventListener('touchend',e=>{if([...e.changedTouches].some(t=>t.identifier===joy.id)){joy={x:0,y:0,id:null};stick.style.transform='translate(0,0)'}});
let lookTouch=null;lookZone.addEventListener('touchstart',e=>{const t=e.changedTouches[0];lookTouch={id:t.identifier,x:t.clientX,y:t.clientY}},{passive:false});lookZone.addEventListener('touchmove',e=>{e.preventDefault();const t=[...e.touches].find(t=>lookTouch&&t.identifier===lookTouch.id);if(!t)return;const dx=t.clientX-lookTouch.x,dy=t.clientY-lookTouch.y;if(mode==='orbit'){orbitYaw-=dx*.0037;orbitPitch=THREE.MathUtils.clamp(orbitPitch-dy*.0037,-1.48,1.48)}else{player.yaw-=dx*.0037;player.pitch-=dy*.0037;player.pitch=THREE.MathUtils.clamp(player.pitch,-1.42,1.42)}lookTouch.x=t.clientX;lookTouch.y=t.clientY},{passive:false});lookZone.addEventListener('touchend',()=>lookTouch=null);

$('#qualityBtn').addEventListener('click',()=>{qualityMode=qualityMode==='hd'?'balanced':'hd';localStorage.setItem('asteroidWalkQuality',qualityMode);renderer.setPixelRatio(Math.min(devicePixelRatio||1,qualityMode==='hd'?(isTouch?1.7:2):(isTouch?1.45:1.8)));if(starField){starField.geometry.setDrawRange(0,qualityMode==='hd'?1800:620);starField.material.size=qualityMode==='hd'?1:.72;starField.material.opacity=qualityMode==='hd'?.38:.28}$('#qualityBtn').textContent=qualityMode==='hd'?'HD QUALITY: ON':'HD QUALITY: OFF';if(mode==='walk'){buildTerrain();terrainGroup.visible=true;updateCamera()}});$('#qualityBtn').textContent=qualityMode==='hd'?'HD QUALITY: ON':'HD QUALITY: OFF';landBtn.addEventListener('click',startWalk);$('#scienceBtn').addEventListener('click',()=>science.classList.remove('hidden'));$('#missionBtn').addEventListener('click',()=>$('#missionGallery').classList.remove('hidden'));$('[data-close="missionGallery"]').addEventListener('click',()=>$('#missionGallery').classList.add('hidden'));$('[data-close="science"]').addEventListener('click',()=>science.classList.add('hidden'));$('#worldBtn').addEventListener('click',showLanding);$('#jumpBtn').addEventListener('click',jump);$('#escapeBtn').addEventListener('click',escapeTest);$('#orbitBtn').addEventListener('click',()=>mode==='orbit'?leaveOrbit():enterOrbit());$('#returnBtn').addEventListener('click',returnToSurface);$('#mobileBackBtn').addEventListener('click',showLanding);$('#mobileMenuBtn').addEventListener('click',()=>science.classList.remove('hidden'));
window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(Math.min(devicePixelRatio||1,qualityMode==='hd'?(isTouch?1.7:2):(isTouch?1.45:1.8)));if(mode==='landing')previewGroup.position.x=innerWidth<760?18:86});

function animate(){requestAnimationFrame(animate);const dt=Math.min(clock.getDelta(),.04);if(mode==='landing'){previewGroup.rotation.y+=dt*.075;previewGroup.rotation.x+=dt*.007}else if(mode==='orbit'){orbitMovement(dt);updateOrbitCamera();updateReadouts()}else{movement(dt);physics(dt);updateCamera();updateReadouts()}renderer.render(scene,camera)}

renderCards();buildPreview();showLanding();animate();
if(new URLSearchParams(location.search).has('autowalk')) setTimeout(startWalk,250);






