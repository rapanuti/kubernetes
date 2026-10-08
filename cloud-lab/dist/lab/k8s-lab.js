// Laboratorio de Kubernetes: terminal (xterm.js) + mapa visual del clúster + retos guiados.
// Se monta en la sección de práctica de Kubernetes con window.mountK8sLab(elemento).
(()=>{
const STORE='cloudlab-k8s-lab',DONE='cloudlab-k8s-retos',BRIDGE='cloudlab-aks-bridge';
const ASSETS=['vendor/xterm.css','vendor/xterm.js','vendor/addon-fit.js','vendor/js-yaml.js','lab/term.js','lab/k8s-engine.js'];
const h=t=>String(t??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let active=null;

const loadAsset=src=>{
  const cache=window.__cloudLabAssets=window.__cloudLabAssets||{};
  return cache[src]=cache[src]||new Promise((res,rej)=>{
    if(src.endsWith('.css')){const l=document.createElement('link');l.rel='stylesheet';l.href=src;l.onload=res;l.onerror=()=>rej(new Error(src));document.head.appendChild(l);return}
    const s=document.createElement('script');s.src=src;s.onload=res;s.onerror=()=>rej(new Error(src));document.head.appendChild(s);
  });
};
const load=()=>ASSETS.reduce((p,src)=>p.then(()=>loadAsset(src)),Promise.resolve());
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
    this.sim=K8sSim.create({yaml:jsyaml,saved,aks:readJSON(BRIDGE)});
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
  dispose(){clearInterval(this.timer);this.t&&this.t.dispose()}

  // ---------- Terminal ----------
  initTerm(){
    const sim=this.sim;
    const t=this.t=new CloudLabTerm(this.el.querySelector('.term'),{
      run:(line,stdin)=>{this.syncBridge();return sim.run(line,stdin)},
      complete:b=>sim.complete(b),
      prompt:()=>this.promptStr(),
      history:sim.state.history,
      colorize,
      after:r=>this.afterRun(r),
    });
    this.term=t.term;
    const S=sim.state;
    t.write(`\x1b[1;36mCloud Lab\x1b[0m · terminal de Kubernetes simulada (\x1b[36mminikube\x1b[0m, Kubernetes ${K8sSim.VERSION})\n`);
    if(sim.restored){const left=Math.max(0,Math.round((sim.expiresAt()-Date.now())/3600000));t.write(`\x1b[2mClúster restaurado: ${S.items.filter(o=>!o.namespace||!['kube-system','kube-public','kube-node-lease'].includes(o.namespace)).length} objetos guardados. Se conserva ${left} h más si no lo usas.\x1b[0m\n`)}
    else t.write(`\x1b[2mClúster nuevo. Tu trabajo se guarda en este navegador durante 48 h desde el último uso.\x1b[0m\n`);
    const aks=Object.values(S.ctx.contexts).filter(c=>c.aks).length;
    if(aks)t.write(`\x1b[2mContextos de AKS importados desde la terminal de Azure: ${aks}. Míralos con kubectl config get-contexts.\x1b[0m\n`);
    t.write(`Escribe \x1b[33mhelp\x1b[0m para empezar, \x1b[33mkubectl --help\x1b[0m para ver los comandos o pulsa \x1b[33mTab\x1b[0m para autocompletar.\n\n`);
    t.prompt();
    setTimeout(()=>t.focus(),50);
  }
  promptStr(){
    const S=this.sim.state,ns=S.ctx.contexts[S.ctx.current].namespace||'default';
    this.ctxEl.textContent=`⎈ ${S.ctx.current} · ns: ${ns}`;
    return`\x1b[1;32muser@cloudlab\x1b[0m:\x1b[1;34m~\x1b[0m \x1b[36m(⎈ ${S.ctx.current}|${ns})\x1b[0m$ `;
  }
  setLine(s){this.t.setLine(s)}
  exec(line){this.t.exec(line)}
  // Contextos de AKS creados con "az aks get-credentials" en la terminal de Azure.
  syncBridge(){this.sim.syncAks(readJSON(BRIDGE))}
  afterRun(r){
    if(r.reset){this.done={};writeJSON(DONE,this.done);this.t.clearHistory()}
    writeJSON(STORE,this.sim.serialize());
    this.snapshot(true);
    this.drawMap();this.drawRetos(true);
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
    const podChip=(p,showNode)=>{const{v,cls}=pst(p);return`<button class="pod ${cls}${fresh(p.uid)}" data-desc="kubectl describe pod ${h(p.name)} -n ${h(p.namespace)}" title="${h(p.name)} · ${h(v.status)}${p.spec.nodeName?' · '+h(p.spec.nodeName):''}"><span class="dot"></span>${h(shortPod(p.name))}${showNode&&p.spec.nodeName?`<small>${h(p.spec.nodeName.replace('minikube-','').replace(/^aks-nodepool1-\d+-/,''))}</small>`:''}</button>`};
    const S_ctxNs=S.ctx.contexts[S.ctx.current].namespace||'default';
    // Nodos
    const nodes=list('Node').map(n=>{
      const pods=list('Pod').filter(p=>p.spec.nodeName===n.name&&(this.showSystem||!sys.includes(p.namespace)));
      return`<div class="cnode${n.spec.unschedulable?' cordoned':''}${fresh(n.uid)}" data-desc="kubectl describe node ${h(n.name)}"><div class="cnode-h"><span class="ico">▣</span><b>${h(n.name)}</b><span class="tag">${'node-role.kubernetes.io/control-plane' in n.labels?'control-plane':n.status.aks?'agent · nodepool1':'worker'}</span><span class="badge ${n.spec.unschedulable?'warn':'ok'}">${n.spec.unschedulable?'SchedulingDisabled':'Ready'}</span></div><div class="pods">${pods.map(p=>podChip(p)).join('')||'<span class="empty-s">sin Pods</span>'}</div></div>`;
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
    const html=`<div class="csec"><p class="csec-t">Clúster ${h(S.cluster||'minikube')}${S.cluster&&S.cluster!=='minikube'?' (AKS en Azure)':''} · nodos</p><div class="cnodes">${nodes}</div>${pending.length?`<p class="pending-note">⚠ ${pending.length} Pod${pending.length>1?'s':''} sin nodo (Pending): no hay nodos programables.</p>`:''}</div><div class="csec"><p class="csec-t">Namespaces</p><div class="cnss">${nsHtml}</div></div>${S.running?'':'<div class="stopped">El clúster está parado. Arráncalo con <code>minikube start</code>.</div>'}`;
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
