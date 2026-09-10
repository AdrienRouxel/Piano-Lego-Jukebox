// Page ranges checked against LEGO's official 21323 booklet, revision 6590095.
// These are grouped sequences, not LEGO's numbered, individual-brick steps.
export const ASSEMBLY_GUIDE='https://www.lego.com/cdn/product-assets/product.bi.core.pdf/6590095.pdf';
export const assemblySteps = [
  ['Le châssis',18,78,'Les plaques et les renforts forment le support de la mécanique.'],
  ['L’arbre à cames',78,80,'Les cames décalées prennent place sur leur axe commun.'],
  ['Le moteur',81,83,'Le moteur entraîne l’axe par la transmission.'],
  ['Le hub',84,89,'Le boîtier d’alimentation rejoint le moteur à l’intérieur de la caisse.'],
  ['Le capteur',90,98,'Le capteur et son drapeau détectent l’action du clavier.'],
  ['Les étouffoirs',99,111,'La rangée de leviers prépare le mécanisme de sustain.'],
  ['La table',112,139,'La table vient recouvrir les éléments électroniques.'],
  ['La caisse',140,225,'Les parois et les renforts donnent au piano sa silhouette.'],
  ['Le cadre et les cordes',226,251,'Les éléments dorés reproduisent le cadre et les cordes décoratives.'],
  ['Les pieds',252,269,'Les trois pieds et leurs roulettes soutiennent l’instrument.'],
  ['La pédale',270,287,'La pédale et sa tringlerie relient le pied du pianiste aux étouffoirs.'],
  ['Le clavier et ses marteaux',288,418,'Les 25 touches et leurs marteaux composent le clavier amovible.'],
  ['Le pupitre et le rabat',419,464,'Le devant du piano reçoit son rabat et son pupitre.'],
  ['La ceinture courbe',465,485,'L’habillage extérieur achève la courbe de la caisse.'],
  ['Le grand couvercle',486,526,'Le couvercle renforcé rejoint ses charnières et sa béquille.'],
  ['La banquette',527,543,'Le mécanisme de réglage et l’assise terminent la construction.'],
].map(([title,firstPage,lastPage,description])=>({title,firstPage,lastPage,description,duration:6}));

export class AssemblyClock {
  constructor(steps=assemblySteps){this.steps=steps;this.index=0;this.progress=0;this.speed=1;this.playing=false;}
  seek(index){this.index=Math.max(0,Math.min(this.steps.length-1,Math.round(index)));this.progress=1;this.playing=false;}
  restart(){this.index=0;this.progress=0;this.playing=true;}
  toggle(){if(this.index===this.steps.length-1&&this.progress===1){this.restart();return;}this.playing=!this.playing;}
  advance(seconds){
    if(!this.playing||!Number.isFinite(seconds)||seconds<=0)return;
    let remaining=seconds*this.speed;
    while(remaining>0&&this.playing){
      const duration=this.steps[this.index].duration,needed=(1-this.progress)*duration;
      if(remaining<needed){this.progress+=remaining/duration;break;}
      remaining-=needed;this.progress=1;
      if(this.index===this.steps.length-1){this.playing=false;break;}
      this.index++;this.progress=0;
    }
  }
}

// Procedural meshes are grouped by the corresponding booklet chapter.
// Order inside a chapter is illustrative; one mesh can represent many bricks.
export function assemblyPhase(part,mesh,index){
  if(part.id==='body')return mesh.position.z<-.8&&mesh.position.x>-.5?13:7;
  if(part.id==='strings')return index===0?6:8;
  if(part.id.startsWith('key-'))return 11;
  return {base:0,cams:1,motor:2,hub:3,sensor:4,dampers:5,keyboard:11,hammers:11,pedals:10,stand:12,lid:14,prop:14,bench:15, 'leg-0':9,'leg-1':9,'leg-2':9}[part.id];
}

export function buildAssemblyUnits(parts){
  const phases=assemblySteps.map(()=>[]);
  for(const part of parts)part.meshes.forEach((mesh,index)=>{
    const phase=assemblyPhase(part,mesh,index);
    if(!phases[phase])throw new Error(`Missing assembly chapter: ${part.id}`);
    phases[phase].push({part,mesh,home:mesh.position.clone()});
  });
  return phases;
}

export function unitProgress(clock,phase,index,count){
  if(phase<clock.index)return 1;
  if(phase>clock.index)return -1;
  // Keep a short reading hold after each chapter has arrived.
  const progress=clock.progress/.8*(count+3)-index;
  return progress<=0?-1:Math.min(1,progress/3);
}
