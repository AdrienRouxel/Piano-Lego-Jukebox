import * as T from '../vendor/three/three.module.min.js';
import { camPhase, camLift } from './music/camshaft.js';

export const overview = {
  title: 'Un grand piano. Une petite mécanique.',
  description: 'Sous la carrosserie noire, une chaîne de leviers transforme la rotation d’un moteur en mouvement des touches. Écartez les pièces pour suivre ce chemin.',
  facts: [['Modèle réel', 'LEGO Ideas Grand Piano · 21323'], ['Construction', '3 662 pièces · 25 touches'], ['Dimensions, couvercle fermé', '30,5 × 35,5 × 22,5 cm']],
  context: 'Cliquez sur le piano ou choisissez un composant pour découvrir son fonctionnement.',
};
export const specs = {
  body: ['La ceinture', 'Elle dessine la silhouette asymétrique du piano à queue et entoure sa mécanique.', [['Construction', 'Briques et éléments courbes noirs'], ['Fonction', 'Structure et habillage']]],
  base: ['Le châssis', 'La base porte le clavier amovible, la transmission et les éléments électroniques.', [['Structure', 'Assemblage de plaques et poutres'], ['Fonction', 'Support des sous-ensembles']]],
  lid: ['Le grand couvercle', 'Le couvercle peut être relevé et maintenu ouvert pour dévoiler l’intérieur, comme sur un piano à queue.', [['Modèle réel', 'Couvercle ouvrant avec béquille'], ['Finition', 'Surfaces noires lisses']]],
  strings: ['La table et les cordes', 'Les cordes et le cadre reproduisent l’intérieur d’un piano acoustique. Sur le modèle LEGO, ils sont décoratifs.', [['Aspect', 'Cadre doré et cordes représentées'], ['Acoustique', 'Aucune production de notes']], 'Dans ce projet, le son est produit par l’ordinateur. Les cordes du modèle ne sont pas accordées.'],
  keyboard: ['Le clavier amovible', 'Le clavier du 21323 réunit 25 touches. Chacune possède sa propre liaison mécanique avec un marteau.', [['Clavier', '15 touches blanches · 10 noires'], ['Modèle réel', 'Sous-ensemble amovible']], 'En lecture automatique, les touches suivent le motif mécanique de l’arbre à cames, pas les notes exactes de la partition.'],
  cams: ['L’arbre à cames', 'Un axe Technic commun porte des leviers décalés. Sa rotation soulève les touches successivement.', [['Entraînement', 'Un axe commun aux touches'], ['Commande', 'Vitesse globale du moteur']], 'Le jukebox adapte la vitesse à l’intensité musicale. Il ne peut pas choisir une touche particulière.'],
  hammers: ['Les marteaux', 'Chaque touche entraîne un marteau. Cette mécanique miniature reproduit le geste d’un piano acoustique.', [['Modèle réel', 'Un marteau associé à chaque touche'], ['Action', 'Transmission par leviers']]],
  dampers: ['Les étouffoirs', 'Les étouffoirs mobiles reproduisent le mécanisme de sustain. La pédale agit sur leur levée.', [['Modèle réel', 'Étouffoirs et pédale mobiles'], ['Fonction', 'Reproduction mécanique du sustain']]],
  motor: ['Le moteur', 'Le moteur simple Powered Up entraîne la transmission puis l’arbre à cames.', [['Type', 'Simple Medium Linear Motor'], ['Retour de position', 'Sans encodeur']], 'Le navigateur envoie une consigne de puissance au hub en Bluetooth. La vitesse de l’arbre est estimée, pas mesurée.'],
  hub: ['Le hub Powered Up', 'Le hub alimente le moteur et reçoit les commandes Bluetooth du navigateur.', [['Référence', 'Hub 2 ports · 88009'], ['Alimentation', '6 piles AAA'], ['Connexions', 'Moteur et capteur']], 'Le hub commande le mouvement. Le son reste sur l’ordinateur.'],
  sensor: ['Le capteur de distance', 'Le capteur WeDo 2.0 détecte un drapeau actionné lorsqu’une touche est enfoncée.', [['Type', 'Capteur de distance WeDo 2.0'], ['Détection', 'Passage du drapeau']], 'Il détecte une action sur le clavier ; il n’identifie pas la note jouée.'],
  pedals: ['La pédale', 'La pédale mobile est reliée au mécanisme des étouffoirs, pour reproduire le geste du sustain.', [['Action', 'Levée des étouffoirs'], ['Modèle réel', 'Mécanisme mobile']]],
  stand: ['Le pupitre et le rabat', 'Le pupitre porte la partition. Le rabat du clavier s’ouvre, comme sur l’instrument grandeur nature.', [['Détails', 'Pupitre et partition miniature'], ['Clavier', 'Rabat ouvrant']]],
  bench: ['La banquette', 'La banquette accompagne le piano. Son assise capitonnée est reproduite en éléments noirs.', [['Modèle réel', 'Hauteur réglable'], ['Finition', 'Assise à effet capitonné']]],
  leg: ['Un pied à roulette', 'Les pieds soutiennent le piano et se terminent par des roulettes, un détail repris des pianos de concert.', [['Modèle réel', 'Pieds avec roulettes'], ['Fonction', 'Support du piano']]],
};

export function buildPiano() {
  const root = new T.Group(), parts = [], pickables = [];
  const keyPivots=[], hammerPivots=[], damperPivots=[]; let camRotor, motorRotor;
  const materials = {
    black: new T.MeshPhysicalMaterial({ color: 0x16191d, roughness: .25, metalness: .04, clearcoat: .35, clearcoatRoughness: .22 }),
    dark: new T.MeshStandardMaterial({ color: 0x303439, roughness: .36 }),
    white: new T.MeshPhysicalMaterial({ color: 0xf6f1dd, roughness: .27, clearcoat: .3 }),
    gold: new T.MeshStandardMaterial({ color: 0xba9050, roughness: .34, metalness: .55 }),
    tan: new T.MeshStandardMaterial({ color: 0xbba575, roughness: .7 }),
    red: new T.MeshStandardMaterial({ color: 0x852f28, roughness: .55 }),
    blue: new T.MeshStandardMaterial({ color: 0x164ca3, roughness: .45 }),
    green: new T.MeshStandardMaterial({ color: 0x398e3d, roughness: .5 }),
    gray: new T.MeshStandardMaterial({ color: 0x8e959c, roughness: .42, metalness: .12 }),
    light: new T.MeshStandardMaterial({ color: 0xe2e3dc, roughness: .38 }),
    wire: new T.MeshStandardMaterial({ color: 0x24272b, roughness: .65 }),
  };
  const boxGeo = new T.BoxGeometry(1,1,1), studGeo = new T.CylinderGeometry(.105,.11,.075,12);
  const cylinderCache = new Map();
  function part(id, type, position, explosion, title) {
    const g = new T.Group(); g.position.fromArray(position); root.add(g);
    const spec = specs[type];
    const data = { id, type, group:g, home:g.position.clone(), offset:new T.Vector3(...explosion), focus:0, title:title || spec[0], description:spec[1], facts:spec[2], context:spec[3], meshes:[] };
    g.userData.part = data; parts.push(data); return data;
  }
  function mesh(p, geo, mat, position, scale) {
    const m = new T.Mesh(geo, materials[mat]); m.position.fromArray(position);
    if (scale) m.scale.fromArray(scale);
    m.castShadow = true; m.receiveShadow = true; m.userData.part = p;
    p.group.add(m); p.meshes.push(m); pickables.push(m); return m;
  }
  const box = (p, size, pos, mat='black') => mesh(p,boxGeo,mat,pos,size);
  function cylinder(p,r,h,pos,mat='black',axis='y') {
    const key = `${r}:${h}`;
    if (!cylinderCache.has(key)) cylinderCache.set(key,new T.CylinderGeometry(r,r,h,20));
    const m = mesh(p,cylinderCache.get(key),mat,pos);
    if(axis==='x') m.rotation.z=Math.PI/2;
    if(axis==='z') m.rotation.x=Math.PI/2;
    return m;
  }
  function studs(p,nx,nz,pos,mat='black',pitch=.28) {
    const m = new T.InstancedMesh(studGeo, materials[mat], nx*nz); const transform = new T.Object3D();
    let i=0; for(let x=0;x<nx;x++) for(let z=0;z<nz;z++) {
      transform.position.set(pos[0]+(x-(nx-1)/2)*pitch,pos[1],pos[2]+(z-(nz-1)/2)*pitch); transform.updateMatrix(); m.setMatrixAt(i++,transform.matrix);
    }
    m.castShadow=true; m.receiveShadow=true; m.userData.part=p; p.group.add(m); p.meshes.push(m); pickables.push(m);
  }
  function rod(p,a,b,r,mat) {
    const start=new T.Vector3(...a), end=new T.Vector3(...b), diff=end.clone().sub(start);
    const m=cylinder(p,r,diff.length(),start.add(end).multiplyScalar(.5).toArray(),mat);
    m.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),diff.normalize()); return m;
  }
  function pivot(p, members, at) {
    const g=new T.Group();g.position.fromArray(at);p.group.add(g);
    for(const m of members){m.position.sub(g.position);g.add(m);}
    return g;
  }
  function outline(front=3.65) {
    const s=new T.Shape(); s.moveTo(-4.7,front); s.lineTo(4.7,front); s.lineTo(4.7,.8);
    s.bezierCurveTo(4.7,-.4,2.9,-.6,2.75,-2.2);
    s.bezierCurveTo(2.5,-5.1,.25,-6.8,-2.2,-6.8);
    s.lineTo(-4.35,-6.8);s.quadraticCurveTo(-4.7,-6.8,-4.7,-6.45);s.closePath();return s;
  }
  function plate(p,y,depth,mat,scale=1,front=3.65) {
    const geo=new T.ExtrudeGeometry(outline(front),{depth,bevelEnabled:true,bevelSegments:2,steps:1,bevelSize:.035,bevelThickness:.035,curveSegments:32});
    geo.rotateX(Math.PI/2); // outline's second coordinate becomes z; depth extends downwards
    return mesh(p,geo,mat,[0,y,0],[scale,1,scale]);
  }
  const base=part('base','base',[0,3.05,0],[0,0,0]); plate(base,0,.28,'black');
  for(let x=-3.8;x<=3.8;x+=1.25) { const length=x>1.2?2.4:x>0?4.2:7.3, z=3.1-length/2; box(base,[.26,.3,length],[x,-.25,z],'dark'); }
  const body=part('body','body',[0,3.32,0],[-.6,2.3,-1.5]);
  // Brick courses follow the curved perimeter, leaving the keyboard aperture clear.
  const edge=outline().getPoints(58); // closed outline; front edge is intentionally omitted
  for(let i=1;i<edge.length-1;i++) {
    const a=edge[i], b=edge[i+1]; const length=a.distanceTo(b); if(length<.04) continue;
    const count=Math.max(1,Math.ceil(length/.6));
    for(let j=0;j<count;j++) {
      const t=(j+.5)/count, x=T.MathUtils.lerp(a.x,b.x,t), z=T.MathUtils.lerp(a.y,b.y,t);
      for(let row=0;row<6;row++) { const m=box(body,[.24,.255,length/count+.01],[x,row*.265,z]); m.rotation.y=Math.atan2(b.x-a.x,b.y-a.y); }
    }
  }
  box(body,[9.4,.32,.28],[0,.2,3.65]);
  box(body,[.46,.86,2.15],[-4.5,.25,2.6]); box(body,[.46,.86,2.15],[4.5,.25,2.6]);
  studs(body,1,25,[-4.7,1.5,-2.7]);
  const strings=part('strings','strings',[0,4.38,-.2],[0,1.45,-2.8]);
  plate(strings,0,.14,'tan',.86,.7);
  box(strings,[7.3,.22,.23],[-.4,.18,.8],'gold');
  rod(strings,[-3.8,.19,-4.8],[-3.8,.19,.7],.13,'gold');
  rod(strings,[-3.8,.19,-4.8],[1.9,.19,-1.5],.14,'gold');
  rod(strings,[-3.8,.19,.7],[1.9,.19,-1.5],.13,'gold');
  for(let i=0;i<25;i++) {
    const x=-3.5+i*.26, back=-4.75+Math.max(0,i-4)*.17;
    for(let s=0;s<2;s++) rod(strings,[x+s*.055,.25,.65],[x+s*.055,.25,back],.009,'gold');
    cylinder(strings,.048,.15,[x,.29,.73],'gray');
  }
  for(let i=0;i<4;i++) rod(strings,[-3.2+i*1.2,.18,.7],[-3.5+i*.65,.18,-4.1],.07,'gold');
  const keys=part('keyboard','keyboard',[0,3.5,2.6],[0,.35,2.8]);
  box(keys,[8.5,.18,2.7],[0,-.13,0],'tan'); box(keys,[8.5,.09,.16],[0,.14,-.8],'red');
  studs(keys,29,2,[0,-.015,-.95],'tan');
  const keyWidth=.55, notes=['Do','Do ♯','Ré','Ré ♯','Mi','Fa','Fa ♯','Sol','Sol ♯','La','La ♯','Si'];
  let whiteIndex=0;
  for(let i=0;i<25;i++) {
    const black=[1,3,6,8,10].includes(i%12), x=black ? -3.85+(whiteIndex-.5)*keyWidth : -3.85+whiteIndex++*keyWidth;
    const k=part(`key-${i}`,'keyboard',[x,3.7+(black?.22:0),black?2.22:2.62],[x*.25,1.1+(black?.65:0),3.5+(black?-.15:.45)],`Touche ${notes[i%12]} · ${i+1}/25`);
    k.description=`Cette touche ${black?'noire':'blanche'} actionne son marteau par un levier. Elle appartient au clavier amovible de 25 touches du modèle.`;
    k.facts=[['Position sur le clavier',`${i+1} sur 25`],['Type',black?'Touche noire':'Touche blanche'],['Action', 'Levier et marteau associés']];
    box(k,[black?.31:.525,black?.33:.2,black?1.3:2.12],[0,0,0],black?'black':'white');
    box(k,[.19,.16,1.05],[0,-.1,-1.2],'tan'); studs(k,1,3,[0,.025,-1.45], 'tan');
    keyPivots.push(pivot(k,[...k.group.children],[0,-.08,-1.3]));
  }
  const cams=part('cams','cams',[0,3.48,1.27],[0,1.75,2.2]);
  cylinder(cams,.095,8.45,[0,0,0],'gray','x');
  for(let i=0;i<25;i++) { const x=-3.95+i*.329,a=camPhase(i); const m=box(cams,[.15,.44,.15],[x,Math.sin(a)*.15,Math.cos(a)*.15],'dark');m.rotation.x=-a; cylinder(cams,.13,.15,[x,0,0],i%3===0?'blue':i%3===1?'red':'light','x'); }
  cylinder(cams,.36,.16,[0,0,0],'tan','x');
  for(let j=0;j<24;j++){const a=j/24*Math.PI*2;const tooth=box(cams,[.18,.085,.1],[0,Math.sin(a)*.37,Math.cos(a)*.37],'tan');tooth.rotation.x=-a;}
  camRotor=pivot(cams,[...cams.group.children],[0,0,0]);
  for(const x of [-4.15,4.15]) { box(cams,[.2,.65,.65],[x,-.05,0],'gray'); cylinder(cams,.24,.18,[x,0,0],'tan','x'); }
  const hammer=part('hammers','hammers',[0,4.02,1.15],[0,3.4,.65]);
  box(hammer,[8.25,.15,.16],[0,-.23,-.38],'dark');
  for(let i=0;i<25;i++) { const x=-3.95+i*.329,start=hammer.group.children.length;box(hammer,[.105,.16,.95],[x,0,0],'tan');box(hammer,[.24,.28,.32],[x,.11,-.4],'white');cylinder(hammer,.065,.24,[x,-.03,.37],'gray','x');hammerPivots.push(pivot(hammer,hammer.group.children.slice(start),[x,0,.37])); }
  const dampers=part('dampers','dampers',[0,4.14,.25],[0,3.4,-.9]);
  rod(dampers,[-4.05,0,0],[4.05,0,0],.055,'gray');
  for(let i=0;i<25;i++){const x=-3.95+i*.329,start=dampers.group.children.length;box(dampers,[.16,.09,.55],[x,0,0],'dark');box(dampers,[.23,.14,.25],[x,.07,-.18],'white');damperPivots.push(pivot(dampers,dampers.group.children.slice(start),[x,0,.2]));}
  const lid=part('lid','lid',[-4.7,4.96,0],[0,5.8,-1.5]);
  const lidMesh=plate(lid,0,.17,'black',1,1.2); lidMesh.position.x=4.7;
  // Hinge on the straight left side. Positive Z rotation opens the lid upward.
  lid.group.rotation.z=.48;
  // Braced underside and seams of the tiled lid, as in the official assembly.
  const lidOutline=outline(1.2).getPoints(180);
  function section(axis,value) {
    const result=[];const other=axis==='x'?'y':'x';
    for(let i=1;i<lidOutline.length;i++){const a=lidOutline[i-1],b=lidOutline[i];if((a[axis]>value)!==(b[axis]>value))result.push(a[other]+(b[other]-a[other])*(value-a[axis])/(b[axis]-a[axis]));}
    return [Math.min(...result),Math.max(...result)];
  }
  for(const z of [-5,-2,.75]) {const [a,b]=section('y',z);box(lid,[b-a-.4,.16,.22],[(a+b)/2+4.7,-.26,z],'dark');}
  for(let x=-4.35;x<4.5;x+=.55){const [a,b]=section('x',x);box(lid,[.008,.006,b-a-.3],[x+4.7,.04,(a+b)/2],'dark');}

  for(let i=0;i<3;i++) cylinder(lid,.10,.65,[0,-.04,-4+i*2.15],'gold','z');
  const prop=part('prop','lid',[2.8,4.87,-1.8],[2.1,3.5,-.4],'La béquille du couvercle');
  rod(prop,[0,0,0],[-.45,3.65,0],.055,'black');
  const stand=part('stand','stand',[0,4.38,1.25],[0,3.2,2.6]);
  const board=box(stand,[8.4,.42,.18],[0,0,0]); board.rotation.x=-.12;
  box(stand,[3.0,.08,1.1],[0,.15,-.55]);
  const music=box(stand,[2.4,1.15,.035],[0,.76,-.7],'white'); music.rotation.x=-.18;
  for(let row=0;row<10;row++) box(stand,[2.12,.008,.018],[0,.33+row*.085,-.57-row*.015],'dark');
  for(let i=0;i<19;i++) { const n=box(stand,[.05,.034,.025],[-.94+(i%10)*.2,.39+(i%4)*.09+Math.floor(i/10)*.43,-.55-(i%4)*.016-Math.floor(i/10)*.078],'dark'); n.rotation.z=.25; }
  const motor=part('motor','motor',[0,3.63,-.4],[5.8,1.2,.9]);
  box(motor,[1.25,.8,1.65],[0,0,0],'light'); box(motor,[1.29,.3,1.69],[0,-.3,0],'gray');
  cylinder(motor,.42,.22,[0,0,.92],'gray','z'); const outputAxle=cylinder(motor,.1,.65,[0,0,1.25],'red','z');
  motorRotor=pivot(motor,[outputAxle],[0,0,1.25]);
  const wormPoints=[];
  for(let i=0;i<=96;i++){const a=i/96*Math.PI*8;wormPoints.push(new T.Vector3(Math.cos(a)*.15,Math.sin(a)*.15,-.32+i/96*.64));}
  const worm=mesh(motor,new T.TubeGeometry(new T.CatmullRomCurve3(wormPoints),96,.035,6,false),'tan',[0,0,0]);motorRotor.add(worm);
  studs(motor,4,2,[0,.44,.35],'gray');
  const hub=part('hub','hub',[1.65,3.65,-1.25],[5.2,1,-4]);
  box(hub,[2.6,.9,1.8],[0,0,0],'light'); box(hub,[2.63,.27,1.83],[0,-.35,0],'gray'); studs(hub,8,5,[0,.49,0],'light');
  cylinder(hub,.18,.055,[0,.53,0],'green');hub.group.rotation.y=Math.PI/2;
  for(const x of [-.63,.63]) { box(hub,[.49,.26,.04],[x,.04,.918],'dark'); box(hub,[.3,.11,.055],[x,.04,.94],'gray'); }
  const sensor=part('sensor','sensor',[-3.3,3.66,.85],[-5,1.9,1.6]);
  box(sensor,[.78,.65,.75],[0,0,0],'light');box(sensor,[.8,.46,.12],[0,.02,.41],'dark');
  cylinder(sensor,.15,.045,[0,.02,.49],'black','z');studs(sensor,2,2,[0,.37,0],'light');
  for(const p of [hub,motor,sensor]) {
    const sign=p.id==='sensor'?1:-1;const curve=new T.CatmullRomCurve3([new T.Vector3(sign*.3,-.2,-.5),new T.Vector3(sign*.8,-.3,-.8),new T.Vector3(sign*1.4,-.3,-.4),new T.Vector3(sign*1.7,-.2,-.7)]);
    mesh(p,new T.TubeGeometry(curve,20,.038,6,false),'wire',[0,0,0]);
  }
  const pedals=part('pedals','pedals',[0,1,2.4],[0,-.25,2.5]);
  box(pedals,[1.45,.23,.5],[0,0,0]);rod(pedals,[0,.1,0],[0,3.9,-.5],.07,'gold');
  for(let i=-1;i<=1;i++){box(pedals,[.25,.12,.77],[i*.42,-.08,.4],'gold');rod(pedals,[i*.42,0,0],[i*.42,3.7,-.3],.04,'dark');}
  for(const [i,pos] of [[0,[-4.1,2.55,2.7]],[1,[4.1,2.55,2.7]],[2,[-2.6,2.55,-5.3]]]) {
    const p=part(`leg-${i}`,'leg',pos,[pos[0]*.3,0,pos[2]*.24],`Pied à roulette ${i+1}`);
    box(p,[.65,4.6,.65],[0,0,0]);box(p,[.9,.25,.9],[0,2.28,0]);box(p,[.5,.26,.5],[0,-2.38,0],'gold');
    cylinder(p,.22,.4,[0,-2.6,0],'gold','x');
    for(let y=-2;y<2.25;y+=.27) box(p,[.659,.015,.659],[0,y,0],'dark');
  }
  const bench=part('bench','bench',[0,3.35,5.8],[-2.6,0,3.7]);
  box(bench,[3.1,.24,1.65],[0,0,0]);
  for(let x=0;x<6;x++)for(let z=0;z<3;z++) box(bench,[.495,.19,.51],[-1.25+x*.5,.2,-.52+z*.52]);
  for(const x of [-1.25,1.25])for(const z of [-.58,.58]) {box(bench,[.25,3.15,.25],[x,-1.7,z]);box(bench,[.3,.09,.3],[x,-3.25,z],'dark');}
  cylinder(bench,.13,.14,[1.66,-.06,0],'dark','x');
  // 9.4 units = 30.5 cm wide; closed lid ~6.96 units = 22.6 cm.
  // Extend the legs instead of flattening the real set's height/width ratio.
  for(const p of parts) if(!['leg','bench','pedals'].includes(p.type)){p.home.y+=2;p.group.position.y+=2;}
  // Each selectable assembly owns its materials so selection cannot tint neighbours.
  for(const p of parts) {
    const clones=new Map(); for(const m of p.meshes) {if(!clones.has(m.material)) clones.set(m.material,m.material.clone());m.material=clones.get(m.material);}
    p.materials=[...clones.values()]; p.materials.forEach(m=>m.userData.originalColor=m.color.clone());
  }
  function animateMechanism(angle=0,amplitude=0) {
    camRotor.rotation.x=-angle;
    // The represented single-start worm drives the represented 24-tooth gear.
    // This schematic transmission does not measure the real motor speed.
    motorRotor.rotation.z=angle*24;
    for(let i=0;i<25;i++) {
      const lift=camLift(angle,amplitude,i);
      keyPivots[i].rotation.x=lift*.12;
      hammerPivots[i].rotation.x=lift*.48;
      damperPivots[i].rotation.x=lift*.2;
    }
  }
  return {root,parts,pickables,animateMechanism,rig:{keyPivots,hammerPivots,damperPivots,camRotor,motorRotor},outline:outline()};
}
