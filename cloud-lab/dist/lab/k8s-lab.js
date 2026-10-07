// Laboratorio de Kubernetes: terminal (xterm.js) + mapa visual del clúster + retos guiados.
// Se monta en la sección de práctica de Kubernetes con window.mountK8sLab(elemento).
(()=>{
const STORE='cloudlab-k8s-lab',DONE='cloudlab-k8s-retos';
const ASSETS=['vendor/xterm.css','vendor/xterm.js','vendor/addon-fit.js','vendor/js-yaml.js','lab/k8s-engine.js'];
const h=t=>String(t??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let loading=null,active=null;

function load(){
  if(loading)return loading;
  loading=ASSETS.reduce((p,src)=>p.then(()=>new Promise((res,rej)=>{
    if(src.endsWith('.css')){const l=document.createElement('link');l.rel='stylesheet';l.href=src;l.onload=res;l.onerror=rej;document.head.appendChild(l);return}
    const s=document.createElement('script');s.src=src;s.onload=res;s.onerror=()=>rej(new Error(src));document.head.appendChild(s);
  })),Promise.resolve());
  return loading;
}
const readJSON=k=>{try{return JSON.parse(localStorage.getItem(k)||'null')}catch{return null}};
const writeJSON=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch{}};

// ---------- Retos guiados (se comprueban contra el estado del clúster) ----------
const RETOS=[
  {id:'ns',t:'Crea un namespace llamado dev',hint:'kubectl create namespace dev',ok:(S,x)=>!!x.find('Namespace','dev')},
  {id:'ctx',t:'Haz que dev sea tu namespace por defecto',hint:'kubectl config set-context --current --namespace=dev',ok:S=>S.ctx.contexts[S.ctx.current].namespace==='dev'},
  {id:'dep',t:'Despliega nginx en dev: Deployment web con 3 réplicas',hint:'kubectl create deployment web --image=nginx --replicas=3 -n dev',ok:(S,x)=>{const d=x.find('Deployment','web','dev');return d&&d.spec.replicas>=3&&/nginx/.test(d.spec.template.containers[0].image)}},
  {id:'svc',t:'Expón web con un Service NodePort en el puerto 80',hint:'kubectl expose deployment web --port=80 --type=NodePort -n dev',ok:(S,x)=>x.list('Service','dev').some(s=>s.spec.type==='NodePort'&&s.spec.ports.some(p=>p.port===80)&&s.spec.selector&&s.spec.selector.app==='web')},
  {id:'scale',t:'Escala web a 5 réplicas y comprueba que las 5 están Running',hint:'kubectl scale deployment web --replicas=5 -n dev  →  kubectl get pods -n dev',ok:(S,x)=>{const d=x.find('Deployment','web','dev');return d&&d.spec.replicas===5&&x.sim.depStatus(d).ready===5}},
  {id:'curl',t:'Desde un Pod de pruebas, llama al Service web',hint:'kubectl run tmp --image=busybox -n dev -- sleep 3600  →  kubectl exec tmp -n dev -- wget -qO- web',ok:(S,x)=>x.list('Pod','dev').some(p=>(p.status.hits||[]).length)},
  {id:'image',t:'Actualiza la imagen de web a nginx:1.29',hint:'kubectl set image deployment/web nginx=nginx:1.29 -n dev',ok:(S,x)=>{const d=x.find('Deployment','web','dev');return d&&d.spec.template.containers.some(c=>c.image==='nginx:1.29')}},
  {id:'undo',t:'Rompe la imagen (p. ej. ngnix:1.29), observa el error y haz rollback',hint:'kubectl set image deployment/web nginx=ngnix:1.29 -n dev  →  kubectl get pods -n dev  →  kubectl rollout undo deployment/web -n dev',ok:(S,x)=>{const d=x.find('Deployment','web','dev');if(!d)return false;const rss=x.list('ReplicaSet','dev').filter(r=>r.owner&&r.owner.name==='web');const bad=rss.some(r=>/ngnix|notexist/.test(r.spec.template.containers[0].image));return bad&&!/ngnix|notexist/.test(d.spec.template.containers[0].image)}},
  {id:'cm',t:'Crea un ConfigMap app-config con LOG_LEVEL=debug en dev',hint:'kubectl create configmap app-config --from-literal=LOG_LEVEL=debug -n dev',ok:(S,x)=>{const c=x.find('ConfigMap','app-config','dev');return c&&c.data.LOG_LEVEL==='debug'}},
  {id:'yaml',t:'Crea cualquier recurso con un manifiesto YAML y kubectl apply',hint:'kubectl run demo --image=nginx --dry-run=client -o yaml > demo.yaml  →  kubectl apply -f demo.yaml',ok:S=>(S.stats&&S.stats.applied)>0},
  {id:'node',t:'Añade un nodo de trabajo al clúster',hint:'minikube node add  →  kubectl get nodes',ok:(S,x)=>x.list('Node').length>1},
  {id:'drain',t:'Drena ese nodo y mira dónde acaban sus Pods',hint:'kubectl drain minikube-m02 --ignore-daemonsets  →  kubectl get pods -A -o wide',ok:(S,x)=>x.list('Node').some(n=>n.name!=='minikube'&&n.spec.unschedulable)},
];

window.mountK8sLab=async el=>{
  if(active){active.dispose();active=null}
  el.innerHTML=`<div class="lab-loading">Cargando el laboratorio…</div>`;
  try{await load()}catch(e){el.innerHTML=`<div class="lab-loading">No se pudo cargar la terminal (${h(e.message)}). Recarga la página.</div>`;return}
  if(!document.body.contains(el))return;
  active=new Lab(el);
};

class Lab{
  constructor(el){
    this.el=el;
    const saved=readJSON(STORE);
    this.sim=K8sSim.create({yaml:jsyaml,saved});
    this.done=readJSON(DONE)||{};
    this.prevUids=new Set();
    this.freshUids=new Set();
    this.showSystem=false;
    el.innerHTML=`<div class="lab-head"><div><h2>Terminal de Kubernetes</h2><p>Un clúster <b>minikube</b> simulado con Kubernetes ${K8sSim.VERSION}. Nada se ejecuta de verdad, pero responde como un clúster real, errores incluidos.</p></div><div class="lab-actions"><button class="btn" data-cmd="help">? Ayuda</button><button class="btn" data-reset>↺ Reiniciar clúster</button></div></div>
<div class="lab-grid"><div class="term-wrap"><div class="term-bar"><span class="dots"><i></i><i></i><i></i></span><span class="term-title">user@cloudlab: ~</span><span class="term-ctx"></span></div><div class="term"></div></div>
<div class="map-wrap"><div class="map-bar"><b>Mapa del clúster</b><label class="map-toggle"><input type="checkbox" data-system> kube-system</label></div><div class="cmap" aria-live="polite"></div><p class="map-legend"><i class="st-run"></i>Running <i class="st-wait"></i>Creando/Pending <i class="st-err"></i>Error <i class="st-done"></i>Completed · Haz clic en un elemento para preparar su <code>describe</code>.</p></div></div>
<div class="lab-retos lesson"><div class="retos-head"><h3>Retos guiados</h3><span class="retos-count"></span></div><ol class="retos"></ol></div>`;
    this.mapEl=el.querySelector('.cmap');
    this.ctxEl=el.querySelector('.term-ctx');
    this.retosEl=el.querySelector('.retos');
    el.querySelector('[data-reset]').onclick=()=>{if(confirm('¿Reiniciar el clúster simulado? Se borran tus recursos y ficheros.')){this.exec('lab reset')}};
    el.querySelector('[data-cmd]').onclick=()=>this.exec('help');
    el.querySelector('[data-system]').onchange=e=>{this.showSystem=e.target.checked;this.drawMap()};
    this.mapEl.onclick=e=>{const n=e.target.closest('[data-desc]');if(n){this.setLine(n.dataset.desc);this.term.focus()}};
    this.retosEl.onclick=e=>{const b=e.target.closest('[data-hint]');if(b){b.nextElementSibling.hidden=!b.nextElementSibling.hidden;b.textContent=b.nextElementSibling.hidden?'Ver pista':'Ocultar pista'}};
    this.initTerm();
    this.snapshot();
    this.drawMap();this.drawRetos();
    this.timer=setInterval(()=>{if(!document.body.contains(this.el)){this.dispose();if(active===this)active=null;return}this.sim.tick();this.drawMap(true)},1500);
  }
  dispose(){clearInterval(this.timer);this.ro&&this.ro.disconnect();this.term&&this.term.dispose()}

  // ---------- Terminal ----------
  initTerm(){
    const term=this.term=new Terminal({convertEol:true,cursorBlink:true,fontFamily:'"SFMono-Regular",Menlo,Consolas,"Liberation Mono",monospace',fontSize:innerWidth<760?11.5:13,lineHeight:1.25,scrollback:3000,
      theme:{background:'#10242a',foreground:'#d5e8e3',cursor:'#5fd4bb',cursorAccent:'#10242a',selectionBackground:'#2b5d57',black:'#10242a',red:'#ff8b7e',green:'#7ddcb0',yellow:'#f1cc74',blue:'#7fb6ff',magenta:'#d6a6ff',cyan:'#5fd4bb',white:'#d5e8e3',brightBlack:'#6e8d89',brightRed:'#ffa69b',brightGreen:'#9be8c4',brightYellow:'#f6db99',brightBlue:'#a3cbff',brightMagenta:'#e4c2ff',brightCyan:'#8ae6d2',brightWhite:'#ffffff'}});
    const fit=this.fit=new FitAddon.FitAddon();
    term.loadAddon(fit);
    term.open(this.el.querySelector('.term'));
    const doFit=()=>{try{fit.fit()}catch{}};
    doFit();
    this.ro=new ResizeObserver(doFit);this.ro.observe(this.el.querySelector('.term'));
    this.buf='';this.cur=0;this.hist=this.sim.state.history.slice();this.hIdx=this.hist.length;this.heredoc=null;this.lastTab=0;this.rendered={rows:0,curRow:0};
    term.onData(d=>this.onData(d));
    const S=this.sim.state;
    const restored=this.sim.restored;
    term.write(`\x1b[1;36mCloud Lab\x1b[0m · terminal de Kubernetes simulada (\x1b[36mminikube\x1b[0m, Kubernetes ${K8sSim.VERSION})\n`);
    if(restored){const left=Math.max(0,Math.round((this.sim.expiresAt()-Date.now())/3600000));term.write(`\x1b[2mClúster restaurado: ${S.items.filter(o=>!o.namespace||!['kube-system','kube-public','kube-node-lease'].includes(o.namespace)).length} objetos guardados. Se conserva ${left} h más si no lo usas.\x1b[0m\n`)}
    else term.write(`\x1b[2mClúster nuevo. Tu trabajo se guarda en este navegador durante 48 h desde el último uso.\x1b[0m\n`);
    term.write(`Escribe \x1b[33mhelp\x1b[0m para empezar, \x1b[33mkubectl --help\x1b[0m para ver los comandos o pulsa \x1b[33mTab\x1b[0m para autocompletar.\n\n`);
    this.prompt();
    setTimeout(()=>term.focus(),50);
  }
  promptStr(){
    if(this.heredoc)return'> ';
    const S=this.sim.state,ns=S.ctx.contexts[S.ctx.current].namespace||'default';
    this.ctxEl.textContent=`⎈ ${S.ctx.current} · ns: ${ns}`;
    return`\x1b[1;32muser@cloudlab\x1b[0m:\x1b[1;34m~\x1b[0m \x1b[36m(⎈ ${S.ctx.current}|${ns})\x1b[0m$ `;
  }
  visLen(s){return s.replace(/\x1b\[[0-9;]*m/g,'').length}
  prompt(){this.p=this.promptStr();this.buf='';this.cur=0;this.rendered={rows:0,curRow:0};this.term.write(this.p)}
  redraw(){
    const t=this.term,cols=t.cols,pl=this.visLen(this.p);
    if(this.rendered.curRow>0)t.write(`\x1b[${this.rendered.curRow}A`);
    t.write('\r\x1b[J'+this.p+this.buf);
    const len=pl+this.buf.length;
    if(len>0&&len%cols===0)t.write('\r\n');
    const endRow=Math.floor(len/cols),tgt=pl+this.cur,tRow=Math.floor(tgt/cols),tCol=tgt%cols;
    if(endRow-tRow>0)t.write(`\x1b[${endRow-tRow}A`);
    t.write('\r'+(tCol?`\x1b[${tCol}C`:''));
    this.rendered={rows:endRow,curRow:tRow};
  }
  setLine(s){this.buf=s;this.cur=s.length;this.redraw()}
  insert(s){this.buf=this.buf.slice(0,this.cur)+s+this.buf.slice(this.cur);this.cur+=s.length;this.redraw()}
  onData(d){
    // Pegar varias líneas: se ejecutan una a una.
    if(d.length>1&&/[\r\n]/.test(d)&&!d.startsWith('\x1b')){
      const parts=d.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n');
      parts.forEach((p,i)=>{if(p)this.insert(p.replace(/\t/g,'  '));if(i<parts.length-1)this.enter()});
      return;
    }
    switch(d){
      case'\r':return this.enter();
      case'\x7f':case'\b':if(this.cur>0){this.buf=this.buf.slice(0,this.cur-1)+this.buf.slice(this.cur);this.cur--;this.redraw()}return;
      case'\x1b[3~':if(this.cur<this.buf.length){this.buf=this.buf.slice(0,this.cur)+this.buf.slice(this.cur+1);this.redraw()}return;
      case'\x1b[D':if(this.cur>0){this.cur--;this.redraw()}return;
      case'\x1b[C':if(this.cur<this.buf.length){this.cur++;this.redraw()}return;
      case'\x1b[H':case'\x01':case'\x1bOH':this.cur=0;this.redraw();return;
      case'\x1b[F':case'\x05':case'\x1bOF':this.cur=this.buf.length;this.redraw();return;
      case'\x1b[1;5D':case'\x1bb':{const m=this.buf.slice(0,this.cur).match(/\S+\s*$/);this.cur=m?m.index:0;this.redraw();return}
      case'\x1b[1;5C':case'\x1bf':{const m=this.buf.slice(this.cur).match(/^\s*\S+/);this.cur+=m?m[0].length:this.buf.length-this.cur;this.redraw();return}
      case'\x1b[A':if(this.heredoc)return;if(this.hIdx>0){this.hIdx--;this.setLine(this.hist[this.hIdx])}return;
      case'\x1b[B':if(this.heredoc)return;if(this.hIdx<this.hist.length-1){this.hIdx++;this.setLine(this.hist[this.hIdx])}else{this.hIdx=this.hist.length;this.setLine('')}return;
      case'\x03':this.term.write('^C\n');this.heredoc=null;this.prompt();return;
      case'\x0c':this.term.clear();this.term.write('\x1b[2J\x1b[H');this.redraw();return;
      case'\x15':this.buf=this.buf.slice(this.cur);this.cur=0;this.redraw();return;
      case'\x0b':this.buf=this.buf.slice(0,this.cur);this.redraw();return;
      case'\x17':{const m=this.buf.slice(0,this.cur).match(/\S+\s*$/);if(m){this.buf=this.buf.slice(0,m.index)+this.buf.slice(this.cur);this.cur=m.index;this.redraw()}return}
      case'\t':return this.tab();
    }
    if(d.startsWith('\x1b'))return;
    const clean=d.replace(/[\x00-\x1f]/g,'');
    if(clean)this.insert(clean);
  }
  tab(){
    if(this.heredoc){this.insert('  ');return}
    const before=this.buf.slice(0,this.cur);
    const{candidates,word}=this.sim.complete(before);
    if(!candidates.length)return;
    const common=candidates.reduce((a,b)=>{let i=0;while(i<a.length&&a[i]===b[i])i++;return a.slice(0,i)});
    if(candidates.length===1){
      const c=candidates[0];
      this.insert(c.slice(word.length)+(/[=/]$/.test(c)?'':' '));
      return;
    }
    if(common.length>word.length){this.insert(common.slice(word.length));return}
    const now=Date.now();
    if(now-this.lastTab<900||candidates.length<=12){
      const w=Math.max(...candidates.map(c=>c.length))+2,per=Math.max(1,Math.floor(this.term.cols/w));
      let out='';candidates.slice(0,120).forEach((c,i)=>{out+=c.padEnd(w);if((i+1)%per===0)out+='\n'});
      this.term.write('\n'+out.trimEnd()+'\n');
      this.rendered={rows:0,curRow:0};
      this.redraw();
    }
    this.lastTab=now;
  }
  enter(){
    const line=this.buf;
    // Mueve el cursor al final antes de escribir la salida.
    this.cur=this.buf.length;this.redraw();this.term.write('\n');
    if(this.heredoc){
      if(line.trim()===this.heredoc.word){const hd=this.heredoc;this.heredoc=null;this.exec(hd.line,hd.body.join('\n')+'\n',true);return}
      this.heredoc.body.push(line);this.p='> ';this.buf='';this.cur=0;this.rendered={rows:0,curRow:0};this.term.write(this.p);return;
    }
    const m=line.match(/<<-?\s*['"]?(\w+)['"]?/);
    if(m){this.heredoc={word:m[1],line,body:[]};this.p='> ';this.buf='';this.cur=0;this.rendered={rows:0,curRow:0};this.term.write(this.p);return}
    if(line.trim()){this.hist=this.hist.filter(x=>x!==line.trim());this.hist.push(line.trim())}
    this.hIdx=this.hist.length;
    this.exec(line,undefined,true);
  }
  exec(line,stdin,typed){
    if(!typed){this.setLine(line);this.term.write('\n');if(line.trim()){this.hist.push(line);this.hIdx=this.hist.length}}
    const r=this.sim.run(line,stdin);
    if(r.clear){this.term.clear();this.term.write('\x1b[2J\x1b[H')}
    if(r.reset){this.done={};writeJSON(DONE,this.done);this.hist=[];this.hIdx=0}
    for(const p of r.parts||[])if(p.out)this.term.write(colorize(p.out,p.err)+'\n');
    writeJSON(STORE,this.sim.serialize());
    this.snapshot(true);
    this.drawMap();this.drawRetos(true);
    this.prompt();
  }

  // ---------- Mapa visual ----------
  snapshot(markNew){
    const uids=new Set(this.sim.state.items.map(o=>o.uid));
    if(markNew){this.freshUids=new Set([...uids].filter(u=>!this.prevUids.has(u)));this.freshAt=Date.now()}
    this.prevUids=uids;
  }
  drawMap(fromTimer){
    const sim=this.sim,S=sim.state;
    const sys=['kube-system','kube-public','kube-node-lease'];
    const list=(k,ns)=>S.items.filter(o=>o.kind===k&&(ns==null||o.namespace===ns));
    const fresh=u=>this.freshUids.has(u)&&Date.now()-this.freshAt<2500?' fresh':'';
    const pst=p=>{const v=sim.podView(p);return{v,cls:v.status==='Running'&&v.ready===v.total?'st-run':/Err|BackOff|Invalid|Unknown|Failed/.test(v.status)?'st-err':v.status==='Completed'?'st-done':v.status==='Terminating'?'st-done':'st-wait'}};
    const podChip=(p,showNode)=>{const{v,cls}=pst(p);return`<button class="pod ${cls}${fresh(p.uid)}" data-desc="kubectl describe pod ${h(p.name)} -n ${h(p.namespace)}" title="${h(p.name)} · ${h(v.status)}${p.spec.nodeName?' · '+h(p.spec.nodeName):''}"><span class="dot"></span>${h(shortPod(p.name))}${showNode&&p.spec.nodeName?`<small>${h(p.spec.nodeName.replace('minikube-',''))}</small>`:''}</button>`};
    const S_ctxNs=S.ctx.contexts[S.ctx.current].namespace||'default';
    // Nodos
    const nodes=list('Node').map(n=>{
      const pods=list('Pod').filter(p=>p.spec.nodeName===n.name&&(this.showSystem||!sys.includes(p.namespace)));
      return`<div class="cnode${n.spec.unschedulable?' cordoned':''}${fresh(n.uid)}" data-desc="kubectl describe node ${h(n.name)}"><div class="cnode-h"><span class="ico">▣</span><b>${h(n.name)}</b><span class="tag">${'node-role.kubernetes.io/control-plane' in n.labels?'control-plane':'worker'}</span><span class="badge ${n.spec.unschedulable?'warn':'ok'}">${n.spec.unschedulable?'SchedulingDisabled':'Ready'}</span></div><div class="pods">${pods.map(p=>podChip(p)).join('')||'<span class="empty-s">sin Pods</span>'}</div></div>`;
    }).join('');
    const pending=list('Pod').filter(p=>!p.spec.nodeName);
    // Namespaces
    const nss=list('Namespace').filter(n=>this.showSystem||!sys.includes(n.name)).sort((a,b)=>(a.name==='default'?-1:b.name==='default'?1:a.name.localeCompare(b.name)));
    const nsHtml=nss.map(n=>{
      const ns=n.name;
      const deps=list('Deployment',ns),svcs=list('Service',ns),pods=list('Pod',ns),cms=list('ConfigMap',ns).filter(c=>c.name!=='kube-root-ca.crt'),secs=list('Secret',ns);
      const owned=new Set();
      const depHtml=deps.map(d=>{
        const st=sim.depStatus(d);
        const rsNames=list('ReplicaSet',ns).filter(r=>r.owner&&r.owner.name===d.name).map(r=>r.name);
        const dp=pods.filter(p=>p.owner&&rsNames.includes(p.owner.name));dp.forEach(p=>owned.add(p.uid));
        const img=d.spec.template.containers.map(c=>c.image).join(', ');
        return`<div class="cres dep${fresh(d.uid)}" data-desc="kubectl describe deployment ${h(d.name)} -n ${h(ns)}"><div class="cres-h"><span class="kind">Deployment</span><b>${h(d.name)}</b><span class="ready ${st.ready===d.spec.replicas?'ok':'warn'}">${st.ready}/${d.spec.replicas}</span></div><small class="img">${h(img)}${d.spec.paused?' · en pausa':''}</small><div class="rs-line"><span class="kind">ReplicaSet</span> ${h(d.status.currentRS||'')}</div><div class="pods">${dp.map(p=>podChip(p,true)).join('')||'<span class="empty-s">0 réplicas</span>'}</div></div>`;
      }).join('');
      const bare=pods.filter(p=>!owned.has(p.uid));
      const svcHtml=svcs.map(s=>{
        const ep=sim.endpoints(s).length;
        const target=s.spec.selector?deps.find(d=>Object.entries(s.spec.selector).every(([k,v])=>d.spec.template.labels[k]===v)):null;
        return`<div class="cres svc${fresh(s.uid)}" data-desc="kubectl describe service ${h(s.name)} -n ${h(ns)}"><div class="cres-h"><span class="kind">Service</span><b>${h(s.name)}</b><span class="tag">${h(s.spec.type)}</span></div><small>${s.spec.type==='ExternalName'?'→ '+h(s.spec.externalName):`${h(s.spec.clusterIP)} · ${s.spec.ports.map(p=>p.port+(p.nodePort?':'+p.nodePort:'')).join(', ')}`}</small><small class="ep ${ep?'ok':s.spec.selector?'warn':''}">${s.spec.selector?`→ ${target?`deploy/${h(target.name)} · `:''}${ep} endpoint${ep===1?'':'s'}`:s.name==='kubernetes'?'→ API server':'sin selector'}</small></div>`;
      }).join('');
      const conf=[...cms.map(c=>`<button class="mini-tag cm${fresh(c.uid)}" data-desc="kubectl describe configmap ${h(c.name)} -n ${h(ns)}">⚙ ${h(c.name)}</button>`),...secs.map(c=>`<button class="mini-tag sec${fresh(c.uid)}" data-desc="kubectl describe secret ${h(c.name)} -n ${h(ns)}">🔒 ${h(c.name)}</button>`)].join('');
      const empty=!deps.length&&!bare.length&&!conf&&!svcs.filter(s=>s.name!=='kubernetes').length;
      return`<div class="cns${ns===S_ctxNs?' current':''}${fresh(n.uid)}"><div class="cns-h" data-desc="kubectl get all -n ${h(ns)}"><span class="ico">◫</span><b>${h(ns)}</b>${ns===S_ctxNs?'<span class="tag cur">actual</span>':''}<span class="count">${pods.length} pod${pods.length===1?'':'s'}</span></div>
${empty?'<p class="empty-s">Namespace vacío. Prueba: <code>kubectl create deployment web --image=nginx'+(ns===S_ctxNs?'':` -n ${h(ns)}`)+'</code></p>':''}${svcHtml?`<div class="svc-row">${svcHtml}</div>`:''}${depHtml}${bare.length?`<div class="cres bare"><div class="cres-h"><span class="kind">Pods sueltos</span></div><div class="pods">${bare.map(p=>podChip(p,true)).join('')}</div></div>`:''}${conf?`<div class="conf">${conf}</div>`:''}</div>`;
    }).join('');
    const html=`<div class="csec"><p class="csec-t">Clúster minikube · nodos</p><div class="cnodes">${nodes}</div>${pending.length?`<p class="pending-note">⚠ ${pending.length} Pod${pending.length>1?'s':''} sin nodo (Pending): no hay nodos programables.</p>`:''}</div><div class="csec"><p class="csec-t">Namespaces</p><div class="cnss">${nsHtml}</div></div>${S.running?'':'<div class="stopped">El clúster está parado. Arráncalo con <code>minikube start</code>.</div>'}`;
    if(fromTimer&&html===this.lastMap)return;
    this.lastMap=html;
    const sc=this.mapEl.scrollTop;
    this.mapEl.innerHTML=html;
    this.mapEl.scrollTop=sc;
  }
  drawRetos(check){
    const S=this.sim.state;
    const x={sim:this.sim,find:(k,n,ns)=>S.items.find(o=>o.kind===k&&o.name===n&&(ns==null||o.namespace===ns)),list:(k,ns)=>S.items.filter(o=>o.kind===k&&(ns==null||o.namespace===ns))};
    let newly=[];
    for(const r of RETOS){let ok=false;try{ok=r.ok(S,x)}catch{}if(ok&&!this.done[r.id]){this.done[r.id]=Date.now();newly.push(r)}}
    writeJSON(DONE,this.done);
    const n=RETOS.filter(r=>this.done[r.id]).length;
    this.el.querySelector('.retos-count').textContent=`${n}/${RETOS.length} completados`;
    this.retosEl.innerHTML=RETOS.map(r=>`<li class="${this.done[r.id]?'done':''}"><span class="chk">${this.done[r.id]?'✓':''}</span><div><span class="rt">${h(r.t)}</span><button class="link" data-hint>Ver pista</button><code class="hint" hidden>${h(r.hint)}</code></div></li>`).join('');
    if(check&&newly.length)for(const r of newly)this.term.write(`\x1b[1;32m✓ Reto completado:\x1b[0m ${r.t}\n`);
  }
}
function shortPod(n){const m=n.match(/^(.*)-([a-z0-9]{8,10})-([a-z0-9]{5})$/);return m?`${m[1]}-…${m[3]}`:n}
function colorize(text,err){
  return text.split('\n').map((l,i)=>{
    if(/^cloudlab:/.test(l))return`\x1b[33m${l}\x1b[0m`;
    if(/^Warning:/.test(l))return`\x1b[33m${l}\x1b[0m`;
    if(err&&(/^(error|Error|The |sh:|E\d{4}|❌|🤷|😿|curl:|wget:|cat:|rm:|base64:|lab:|ls:)/.test(l)||i===0))return`\x1b[31m${l}\x1b[0m`;
    if(i===0&&/^([A-Z][A-Z()\-%]+ {2,})+[A-Z()\-%]+/.test(l))return`\x1b[1m${l}\x1b[0m`;
    if(/^(NAME|NAMESPACE|LAST SEEN|REVISION|CURRENT|ATTRIBUTE|ADDON NAME)\s/.test(l))return`\x1b[1m${l}\x1b[0m`;
    if(/ (created|configured|exposed|scaled|deleted|labeled|annotated|image updated|rolled back|restarted|cordoned|uncordoned|drained|evicted|successfully rolled out)$/.test(l))return`\x1b[32m${l}\x1b[0m`;
    return l;
  }).join('\n');
}
})();
