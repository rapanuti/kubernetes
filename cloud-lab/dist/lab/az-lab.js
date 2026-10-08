// Laboratorio de Azure: terminal de Azure CLI (xterm.js) + mapa de la suscripción + retos guiados de AZ-900.
// Se monta en la sección de práctica de Azure con window.mountAzLab(elemento).
// kubectl usa el mismo estado que la terminal de Kubernetes (localStorage) y los clústeres AKS pasan por el "puente".
(()=>{
const STORE='cloudlab-az-lab',DONE='cloudlab-az-retos',BRIDGE='cloudlab-aks-bridge',K8S='cloudlab-k8s-lab';
const ASSETS=['vendor/xterm.css','vendor/xterm.js','vendor/addon-fit.js','vendor/js-yaml.js','lab/term.js','lab/k8s-engine.js','lab/az-engine.js'];
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

// ---------- Retos guiados (se comprueban contra el estado simulado) ----------
const RG='rg-cloudlab';
const RETOS=[
  {id:'login',t:'Inicia sesión en Azure y elige la suscripción',hint:'az login  →  pulsa Enter para quedarte con la suscripción por defecto',ok:S=>S.loggedIn},
  {id:'rg',t:`Crea el grupo de recursos ${RG} en la región Spain Central`,hint:`az group create -n ${RG} -l spaincentral`,ok:(S,x)=>x.group(RG)&&x.group(RG).location==='spaincentral'},
  {id:'query',t:'Lista tus grupos en formato tabla y luego solo sus nombres con --query',hint:'az group list -o table  →  az group list --query "[].name" -o tsv',ok:S=>S.stats.table>0&&S.stats.query>0},
  {id:'vm',t:`Crea una VM Ubuntu pequeña (Standard_B1s) llamada vm-web en ${RG}`,hint:`az vm create -g ${RG} -n vm-web --image Ubuntu2204 --size Standard_B1s --generate-ssh-keys`,ok:(S,x)=>{const v=x.res('vm',RG,'vm-web');return v&&v.p.size==='Standard_B1s'}},
  {id:'dealloc',t:'Desasigna vm-web para dejar de pagar el cómputo (apagarla con stop no basta)',hint:`az vm stop -g ${RG} -n vm-web  →  mira el aviso  →  az vm deallocate -g ${RG} -n vm-web  →  az vm list -d -o table`,ok:(S,x)=>{const v=x.res('vm',RG,'vm-web');return v&&v.p.power==='deallocated'}},
  {id:'storage',t:'Crea una cuenta de almacenamiento con nombre válido y único y redundancia LRS',hint:`az storage account check-name -n stcloudlab$RANDOM  →  az storage account create -g ${RG} -n <nombre> --sku Standard_LRS`,ok:(S,x)=>x.all('storage').some(s=>s.p.sku==='Standard_LRS')},
  {id:'vnet',t:'Crea la red virtual vnet-cloudlab (10.10.0.0/16) con la subred web (10.10.1.0/24)',hint:`az network vnet create -g ${RG} -n vnet-cloudlab --address-prefixes 10.10.0.0/16 --subnet-name web --subnet-prefixes 10.10.1.0/24`,ok:(S,x)=>{const v=x.all('vnet').find(v=>v.name==='vnet-cloudlab');return v&&v.p.prefixes.includes('10.10.0.0/16')&&v.p.subnets.some(s=>s.name==='web'&&s.prefix==='10.10.1.0/24')}},
  {id:'subnet',t:'Añade la subred db a vnet-cloudlab sin que se solape con web',hint:`az network vnet subnet create -g ${RG} --vnet-name vnet-cloudlab -n db --address-prefixes 10.10.2.0/24`,ok:(S,x)=>{const v=x.all('vnet').find(v=>v.name==='vnet-cloudlab');return v&&v.p.subnets.some(s=>s.name==='db')}},
  {id:'webapp',t:'Publica una web app en un plan de App Service gratuito (F1)',hint:`az appservice plan create -g ${RG} -n plan-cloudlab --sku F1  →  az webapp create -g ${RG} -p plan-cloudlab -n <nombre-único> --runtime "NODE:22-lts"  →  az webapp browse ...`,ok:(S,x)=>x.all('webapp').some(w=>{const p=S.res.find(p=>p.t==='plan'&&x.id(p)===w.p.plan);return p&&(p.p.sku==='F1'||p.p.sku==='FREE')})},
  {id:'rbac',t:`Da a ana.garcia el rol Reader solo sobre ${RG} (mínimo privilegio)`,hint:`az role assignment create --assignee ana.garcia@cloudlabdemo.onmicrosoft.com --role Reader --scope $(az group show -n ${RG} --query id -o tsv)`,ok:S=>S.roles.some(r=>r.role==='Reader'&&/\/resourceGroups\/rg-cloudlab$/i.test(r.scope)&&r.principal==='5c2e4a7d-1b3f-4c6e-8a9d-0e1f2a3b4c5d')},
  {id:'aks',t:'Crea un clúster AKS de 1 nodo',hint:`az aks create -g ${RG} -n aks-cloudlab --node-count 1 --generate-ssh-keys`,ok:(S,x)=>x.all('aks').some(a=>a.p.count===1)},
  {id:'kubectl',t:'Conecta kubectl al clúster AKS y lista sus nodos',hint:`az aks get-credentials -g ${RG} -n aks-cloudlab  →  kubectl get nodes  (el contexto también aparece en la terminal de Kubernetes)`,ok:S=>S.merged.length>0&&S.stats.kubectl>0},
  {id:'tags',t:`Etiqueta ${RG} con env=dev para organizar costes`,hint:`az group update -n ${RG} --tags env=dev  →  az group list --tag env=dev -o table`,ok:(S,x)=>{const g=x.group(RG);return g&&g.tags.env==='dev'}},
  {id:'port',t:'Abre el puerto 80 de vm-web (regla en su NSG)',hint:`az vm open-port -g ${RG} -n vm-web --port 80  →  az network nsg rule list -g ${RG} --nsg-name vm-webNSG -o table`,ok:(S,x)=>{const v=x.res('vm',RG,'vm-web');const nic=v&&S.res.find(n=>n.t==='nic'&&x.id(n)===v.p.nic);const nsg=nic&&S.res.find(n=>n.t==='nsg'&&x.id(n)===nic.p.nsg);return!!nsg&&x.rules(nsg).some(r=>r.direction==='Inbound'&&r.access==='Allow'&&r.ports.some(p=>p==='80'||p==='*'||/^\d+-\d+$/.test(p)&&+p.split('-')[0]<=80&&+p.split('-')[1]>=80))}},
  {id:'blob',t:'Sube un fichero a un contenedor usando tu identidad (--auth-mode login)',hint:`echo "Hola Azure" > hola.txt  →  az storage container create -n datos --account-name <cuenta> --auth-mode login  →  si falta permiso: az role assignment create --assignee user@cloudlabdemo.onmicrosoft.com --role "Storage Blob Data Contributor" --scope $(az storage account show -g ${RG} -n <cuenta> --query id -o tsv)  →  az storage blob upload -c datos -f hola.txt --account-name <cuenta> --auth-mode login`,ok:S=>S.stats.blobUploadLogin>0},
  {id:'kv',t:'Guarda un secreto en un Key Vault (usa RBAC: Owner no basta)',hint:`az keyvault create -g ${RG} -n kv-cloudlab-$RANDOM  →  az keyvault secret set --vault-name <almacén> -n db-password --value "S3cr3t!"  →  lee el error  →  az role assignment create --assignee user@cloudlabdemo.onmicrosoft.com --role "Key Vault Secrets Officer" --scope $(az keyvault show -n <almacén> --query id -o tsv)`,ok:S=>S.stats.secretSet>0},
  {id:'lock',t:`Protege ${RG} con un bloqueo CanNotDelete y comprueba que no se puede borrar`,hint:`az lock create -n no-borrar -g ${RG} --lock-type CanNotDelete  →  az group delete -n ${RG} --yes`,ok:S=>S.stats.scopeLocked>0&&(S.locks.some(l=>/\/resourceGroups\/rg-cloudlab$/i.test(l.scope)&&l.level==='CanNotDelete')||S.stats.lock>0)},
  {id:'policy',t:'Asigna la política "Allowed locations" (solo Europa) y comprueba que deniega otra región',hint:`az policy assignment create -n solo-europa --policy e56962a6-4747-49cd-b67b-bf8b01975c4c --params '{"listOfAllowedLocations":{"value":["spaincentral","westeurope"]}}'  →  az storage account create -g ${RG} -n <nombre> -l eastus  →  az policy state list -o table`,ok:S=>S.stats.policyDenied>0},
  {id:'sql',t:'Crea una base de datos Azure SQL y permite el acceso de los servicios de Azure (regla 0.0.0.0)',hint:`az sql server create -g ${RG} -n sql-cloudlab-$RANDOM -u sqladmin -p "Rapa2026!Lab"  →  az sql server firewall-rule create -g ${RG} -s <servidor> -n AllowAzure --start-ip-address 0.0.0.0 --end-ip-address 0.0.0.0  →  az sql db create -g ${RG} -s <servidor> -n appdb --service-objective Basic`,ok:(S,x)=>x.all('sqlserver').some(s=>Object.keys(s.p.dbs||{}).length&&s.p.rules.some(r=>r.start==='0.0.0.0'&&r.end==='0.0.0.0'))},
  {id:'acr',t:'Construye una imagen en Azure Container Registry y conecta el registro a tu AKS',hint:`az acr create -g ${RG} -n acrcloudlab$RANDOM --sku Basic  →  cat <<EOF > Dockerfile (FROM nginx) EOF  →  az acr build -r <registro> -t web:v1 .  →  az aks update -g ${RG} -n aks-cloudlab --attach-acr <registro>  →  kubectl create deployment web --image=<registro>.azurecr.io/web:v1`,ok:S=>S.stats.acrBuild>0&&S.res.some(a=>a.t==='aks'&&(a.p.acr||[]).length)},
  {id:'activity',t:'Consulta el registro de actividad para ver qué se cambió y quién',hint:`az monitor activity-log list -g ${RG} --offset 1d --query "[].{op:operationName.value, estado:status.value, hora:eventTimestamp}" -o table`,ok:S=>S.stats.activityLog>0},
  {id:'budget',t:'Crea un presupuesto mensual y mira el coste estimado tras adelantar el reloj',hint:'az consumption budget create --budget-name mensual --amount 50 --category cost --time-grain monthly --start-date 2026-10-01 --end-date 2027-09-30  →  lab tiempo +7d  →  az consumption budget list -o table',ok:S=>S.budgets.length>0&&S.offset>0},
  {id:'cleanup',t:`Borra el grupo ${RG} para no dejar nada facturando`,hint:`az lock delete -n no-borrar -g ${RG}  →  az group delete -n ${RG}  →  responde y  →  az group list -o table`,ok:(S,x,done)=>!!done.rg&&S.stats.groupDelete>0&&!x.group(RG)},
];

window.mountAzLab=async el=>{
  if(active){active.dispose();active=null}
  el.innerHTML=`<div class="lab-loading">Cargando el laboratorio…</div>`;
  try{await load()}catch(e){el.innerHTML=`<div class="lab-loading">No se pudo cargar la terminal (${h(e.message)}). Recarga la página.</div>`;return}
  if(!document.body.contains(el))return;
  active=new AzLab(el);
};

class AzLab{
  constructor(el){
    this.el=el;
    this.sim=AzSim.create({yaml:jsyaml,saved:readJSON(STORE),
      kubectl:(args,stdin,bridge)=>{const k=this.k8s(bridge);const r=k.exec(args,stdin);writeJSON(K8S,k.serialize());return r},
      kubectlComplete:line=>this.k8s(this.sim.bridge()).complete(line)});
    this.done=readJSON(DONE)||{};
    this.prev=new Set();this.fresh=new Set();
    el.innerHTML=`<div class="lab-head"><div><h2>Terminal de Azure CLI</h2><p>Azure CLI ${AzSim.VERSION} simulada, como en Azure Cloud Shell. Nada se crea de verdad ni cuesta dinero, pero responde como Azure real, errores incluidos.</p></div><div class="lab-actions"><button class="btn" data-cmd="help">? Ayuda</button><button class="btn" data-reset>↺ Reiniciar Azure</button></div></div>
<div class="lab-grid"><div class="term-wrap"><div class="term-bar"><span class="dots"><i></i><i></i><i></i></span><span class="term-title">user@Azure: ~</span><span class="term-ctx"></span></div><div class="term"></div></div>
<div class="map-wrap"><div class="map-bar"><b>Mapa de la suscripción</b><span class="map-sub"></span></div><div class="cmap azmap" aria-live="polite"></div><p class="map-legend"><i class="st-run"></i>En ejecución <i class="st-stop"></i>Detenida (se factura) <i class="st-off"></i>Desasignada <i class="st-wait"></i>En curso · Clic en un recurso para preparar su <code>show</code>.</p></div></div>
<div class="lab-retos lesson"><div class="retos-head"><h3>Retos guiados · AZ-900</h3><span class="retos-count"></span></div><ol class="retos"></ol></div>`;
    this.mapEl=el.querySelector('.cmap');
    this.ctxEl=el.querySelector('.term-ctx');
    this.subEl=el.querySelector('.map-sub');
    this.retosEl=el.querySelector('.retos');
    el.querySelector('[data-reset]').onclick=()=>{if(confirm('¿Reiniciar el Azure simulado? Se borran tus grupos, recursos y la sesión.'))this.t.exec('lab reset')};
    el.querySelector('[data-cmd]').onclick=()=>this.t.exec('help');
    this.mapEl.onclick=e=>{const n=e.target.closest('[data-cmd]');if(n){this.t.setLine(n.dataset.cmd);this.t.focus()}};
    this.subEl.onchange=e=>{const s=e.target.value;if(s)this.t.exec(`az account set -s "${s}"`)};
    this.retosEl.onclick=e=>{const b=e.target.closest('[data-hint]');if(b){b.nextElementSibling.hidden=!b.nextElementSibling.hidden;b.textContent=b.nextElementSibling.hidden?'Ver pista':'Ocultar pista'}};
    this.initTerm();
    this.snapshot();
    this.drawMap();this.drawRetos();
    this.timer=setInterval(()=>{if(!document.body.contains(this.el)){this.dispose();if(active===this)active=null;return}this.sim.tick();this.drawMap(true)},1500);
  }
  dispose(){clearInterval(this.timer);this.t&&this.t.dispose()}
  // Simulador de Kubernetes con el estado guardado por la otra terminal (se vuelve a leer en cada uso).
  k8s(bridge){
    const k=K8sSim.create({yaml:jsyaml,saved:readJSON(K8S),aks:bridge});
    k.syncAks(bridge);
    return k;
  }

  // ---------- Terminal ----------
  initTerm(){
    const sim=this.sim;
    const t=this.t=new CloudLabTerm(this.el.querySelector('.term'),{
      run:(line,stdin)=>sim.run(line,stdin),
      answer:a=>sim.answer(a),
      cancel:()=>sim.cancel(),
      complete:b=>sim.complete(b),
      prompt:()=>this.promptStr(),
      history:sim.state.history,
      colorize,
      after:r=>this.afterRun(r),
    });
    const S=sim.state;
    t.write(`\x1b[1;36mCloud Lab\x1b[0m · Azure CLI ${AzSim.VERSION} simulada (\x1b[36mAzure Cloud Shell\x1b[0m)\n`);
    if(sim.restored){const left=Math.max(0,Math.round((sim.expiresAt()-Date.now())/3600000));t.write(`\x1b[2mEstado restaurado: ${S.res.filter(r=>r.t==='group').length} grupos de recursos. Se conserva ${left} h más si no lo usas.\x1b[0m\n`)}
    else t.write(`\x1b[2mAzure nuevo. Tu trabajo se guarda en este navegador durante 48 h desde el último uso.\x1b[0m\n`);
    t.write(S.loggedIn?`Escribe \x1b[33mhelp\x1b[0m para ver la ayuda o \x1b[33maz --help\x1b[0m para los comandos. \x1b[33mTab\x1b[0m autocompleta.\n\n`:`Empieza con \x1b[33maz login\x1b[0m. Escribe \x1b[33mhelp\x1b[0m para ver la ayuda; \x1b[33mTab\x1b[0m autocompleta.\n\n`);
    t.prompt();
    setTimeout(()=>t.focus(),50);
  }
  promptStr(){
    const S=this.sim.state,sub=S.subs.find(s=>s.id===S.current);
    this.ctxEl.textContent=S.loggedIn?`▲ ${sub.name}`:'sin sesión · az login';
    return`\x1b[1;32muser@Azure\x1b[0m:\x1b[1;34m~\x1b[0m$ `;
  }
  afterRun(r){
    if(r.reset){this.done={};writeJSON(DONE,this.done);this.t.clearHistory()}
    writeJSON(STORE,this.sim.serialize());
    writeJSON(BRIDGE,this.sim.bridge());
    if(r.kube)this.t.write(`\x1b[2mcloudlab: el contexto también está disponible en la terminal de Kubernetes (Kubernetes → Práctica).\x1b[0m\n`);
    this.snapshot(true);
    this.drawMap();this.drawRetos(true);
  }

  // ---------- Mapa de la suscripción ----------
  snapshot(markNew){
    const ids=new Set(this.sim.state.res.map(r=>this.sim.view.resId(r)));
    if(markNew){this.fresh=new Set([...ids].filter(u=>!this.prev.has(u)));this.freshAt=Date.now()}
    this.prev=ids;
  }
  drawMap(fromTimer){
    const sim=this.sim,S=sim.state,V=sim.view;
    const sub=S.subs.find(s=>s.id===S.current);
    const subOpts=S.loggedIn?`<select aria-label="Suscripción">${S.subs.map(s=>`<option value="${h(s.name)}"${s.id===S.current?' selected':''}>${h(s.name)}</option>`).join('')}</select>`:'';
    if(this.subEl.dataset.v!==subOpts){this.subEl.innerHTML=subOpts;this.subEl.dataset.v=subOpts}
    const fresh=r=>this.fresh.has(V.resId(r))&&Date.now()-this.freshAt<2500?' fresh':'';
    const inSub=r=>r.sub===S.current;
    const rgOf=g=>S.res.filter(r=>r.t!=='group'&&inSub(r)&&r.rg.toLowerCase()===g.name.toLowerCase());
    const busy=r=>V.busy(r);
    const vmState=v=>busy(v)?['st-wait',busy(v)==='Deleting'?'Eliminando':'Creando']:{running:['st-run','En ejecución'],stopped:['st-stop','Detenida · se factura'],deallocated:['st-off','Desasignada']}[v.p.power];
    const vmChip=v=>{const[c,l]=vmState(v);return`<button class="azvm ${c}${fresh(v)}" data-cmd="az vm show -g ${h(v.rg)} -n ${h(v.name)} -d -o table" title="${h(v.name)} · ${h(v.p.size)} · ${h(v.p.image)} · ${h(l)}"><span class="dot"></span><b>${h(v.name)}${locked(v)}</b><small>${h(v.p.size.replace('Standard_',''))} · ${h(l)}${ports(v).length?` · puertos ${h(ports(v).join(','))}`:''}</small></button>`};
    const lockTags=scope=>S.locks.filter(l=>l.scope.toLowerCase()===scope.toLowerCase()).map(l=>`<span class="mini-tag lock" title="${h(l.notes||'')}">🔒 ${h(l.name)} · ${h(l.level)}</span>`).join('');
    const polTags=scope=>S.policies.filter(a=>a.scope.toLowerCase()===scope.toLowerCase()).map(a=>`<span class="mini-tag policy${a.enforcement==='DoNotEnforce'?' off':''}" title="${h(V.policyName(a.def))}${a.enforcement==='DoNotEnforce'?' · DoNotEnforce':''}">📜 ${h(a.name)} · ${h(V.policyName(a.def))}</span>`).join('');
    const tagTags=t=>Object.entries(t||{}).map(([k,v])=>`<span class="mini-tag tagkv">🏷 ${h(k)}${v?'='+h(v):''}</span>`).join('');
    const locked=r=>S.locks.some(l=>l.scope.toLowerCase()===V.resId(r).toLowerCase())?' 🔒':'';
    const ports=v=>{const nic=S.res.find(n=>n.t==='nic'&&V.resId(n)===v.p.nic),nsg=nic&&S.res.find(n=>n.t==='nsg'&&V.resId(n)===nic.p.nsg);return nsg?V.nsgRules(nsg).filter(r=>r.direction==='Inbound'&&r.access==='Allow').flatMap(r=>r.ports):[]};
    const roleTags=scope=>S.roles.filter(r=>r.scope.toLowerCase()===scope.toLowerCase()).map(r=>{const u=sim.users.find(u=>u.id===r.principal);return`<span class="mini-tag role" title="${h(u?u.upn:r.principal)} · ${h(r.role)}">👤 ${h(u?u.upn.split('@')[0]:'?')} · ${h(r.role)}</span>`}).join('');
    let body;
    if(!S.loggedIn)body=`<div class="az-empty"><b>Sin sesión iniciada</b><p>Ejecuta <code>az login</code> para conectarte a tu suscripción simulada.</p></div>`;
    else{
      const groups=S.res.filter(r=>r.t==='group'&&inSub(r)).sort((a,b)=>(a.p.managedBy?1:0)-(b.p.managedBy?1:0)||a.created-b.created);
      const gHtml=groups.map(g=>{
        const res=rgOf(g),gb=busy(g);
        const head=`<div class="azg-h" data-cmd="az resource list -g ${h(g.name)} -o table"><span class="ico">▣</span><b>${h(g.name)}</b><span class="tag">${h(V.disp(g.location))}</span>${locked(g)}${gb?`<span class="badge warn">${gb==='Deleting'?'Eliminando…':gb}</span>`:''}<span class="count">${res.length} recurso${res.length===1?'':'s'}${(c=>c>=0.005?` · $${c.toFixed(2)}`:'')(V.costRows().filter(r=>r.rg&&r.rg.toLowerCase()===g.name.toLowerCase()).reduce((a,r)=>a+r.cost,0))}</span></div>`;
        if(g.p.managedBy){
          const owner=g.p.managedBy.split('/').pop();
          return`<div class="azg managed${fresh(g)}">${head}<p class="empty-s">Grupo de nodos gestionado por AKS <b>${h(owner)}</b>: Azure lo crea y lo borra con el clúster.</p><div class="conf">${res.map(r=>`<span class="mini-tag">${h({vmss:'VMSS',lb:'Load balancer',pip:'IP pública',nsg:'NSG',vnet:'VNet'}[r.t]||r.t)} · ${h(r.name.length>24?r.name.slice(0,22)+'…':r.name)}</span>`).join('')}</div></div>`;
        }
        const vms=res.filter(r=>r.t==='vm');
        const vmIn=new Set();
        const vnets=res.filter(r=>r.t==='vnet').map(v=>{
          const vid=V.resId(v);
          const subs=v.p.subnets.map(sn=>{
            const sid=`${vid}/subnets/${sn.name}`;
            const here=S.res.filter(n=>n.t==='nic'&&n.p.subnet===sid).map(n=>S.res.find(x=>x.t==='vm'&&x.p.nic===V.resId(n))).filter(Boolean);
            here.forEach(x=>vmIn.add(x));
            return`<div class="azsn"><div class="azsn-h"><span class="kind">Subred</span><b>${h(sn.name)}</b><code>${h(sn.prefix)}</code></div>${here.length?`<div class="azvms">${here.map(vmChip).join('')}</div>`:''}</div>`;
          }).join('');
          return`<div class="cres azvnet${fresh(v)}" data-cmd="az network vnet show -g ${h(v.rg)} -n ${h(v.name)} -o table"><div class="cres-h"><span class="kind">Red virtual</span><b>${h(v.name)}</b><span class="tag">${h(v.p.prefixes.join(', '))}</span></div>${subs||'<p class="empty-s">Sin subredes. Añade una con <code>az network vnet subnet create</code>.</p>'}</div>`;
        }).join('');
        const loose=vms.filter(v=>!vmIn.has(v));
        const storage=res.filter(r=>r.t==='storage').map(s=>{const r=V.storageView(s),cs=Object.entries(s.p.containers||{});return`<div class="cres azst${fresh(s)}" data-cmd="az storage account show -g ${h(s.rg)} -n ${h(s.name)} -o table"><div class="cres-h"><span class="kind">Storage</span><b>${h(s.name)}${locked(s)}</b><span class="tag">${h(s.p.sku.replace('Standard_','').replace('Premium_','Premium '))}</span></div><small>${h(s.p.kind)} · ${h(r.primaryEndpoints.blob)}${r.secondaryLocation?` · réplica en ${h(V.disp(r.secondaryLocation))}`:''}</small>${cs.length?`<div class="conf">${cs.map(([n,c])=>`<button class="mini-tag" data-cmd="az storage blob list -c ${h(n)} --account-name ${h(s.name)} --auth-mode login -o table">📦 ${h(n)} · ${Object.keys(c.blobs).length} blob${Object.keys(c.blobs).length===1?'':'s'}${c.pub!=='off'?' · público':''}</button>`).join('')}</div>`:''}</div>`}).join('');
        const sqls=res.filter(r=>r.t==='sqlserver').map(s=>{const dbs=Object.entries(s.p.dbs||{});return`<div class="cres azsql${fresh(s)}" data-cmd="az sql db list -g ${h(s.rg)} -s ${h(s.name)} -o table"><div class="cres-h"><span class="kind">Azure SQL</span><b>${h(s.name)}${locked(s)}</b><span class="tag">${h(s.name)}.database.windows.net</span></div><div class="conf">${dbs.map(([n,d])=>`<span class="mini-tag">🛢 ${h(n)} · ${h(d.sku)}</span>`).join('')||'<span class="empty-s">Sin bases de datos: az sql db create</span>'}</div><small>${s.p.rules.length?'Firewall: '+s.p.rules.map(r=>r.start==='0.0.0.0'&&r.end==='0.0.0.0'?'servicios de Azure':`${h(r.start)}${r.end!==r.start?'–'+h(r.end):''}`).join(', '):'Firewall: sin reglas (nadie puede conectar desde fuera)'}</small></div>`}).join('');
        const acrs=res.filter(r=>r.t==='acr').map(a=>{const reps=Object.entries(a.p.repos||{});const users=S.res.filter(k=>k.t==='aks'&&(k.p.acr||[]).includes(a.name)).map(k=>k.name);return`<div class="cres azacr${fresh(a)}" data-cmd="az acr repository list -n ${h(a.name)} -o table"><div class="cres-h"><span class="kind">Container Registry</span><b>${h(a.name)}${locked(a)}</b><span class="tag">${h(a.p.sku)}</span></div><div class="conf">${reps.map(([n,t])=>`<span class="mini-tag">🐳 ${h(n)}:${h(t.join(', '))}</span>`).join('')||'<span class="empty-s">Sin imágenes: az acr build -r '+h(a.name)+' -t app:v1 .</span>'}</div><small>${users.length?'AcrPull concedido a AKS: '+users.map(h).join(', '):'Ningún AKS puede descargar sus imágenes (az aks update --attach-acr)'}</small></div>`}).join('');
        const mon=res.filter(r=>r.t==='alert'||r.t==='ag').map(r=>r.t==='alert'?`<span class="mini-tag alert" title="${h(r.p.cond.agg)} ${h(r.p.cond.metric)} ${h(r.p.cond.op)} ${h(r.p.cond.threshold)}">🔔 ${h(r.name)} · ${h(r.p.cond.metric)} ${h(r.p.cond.op)} ${h(r.p.cond.threshold)}</span>`:`<span class="mini-tag">📣 ${h(r.name)} · ${r.p.emails.length} email</span>`).join('');
        const vaults=res.filter(r=>r.t==='kv').map(k=>{const n=Object.keys(k.p.secrets||{}).length;return`<div class="cres azkv${fresh(k)}" data-cmd="az keyvault secret list --vault-name ${h(k.name)} -o table"><div class="cres-h"><span class="kind">Key Vault</span><b>${h(k.name)}${locked(k)}</b><span class="tag">${k.p.rbac?'RBAC':'Access policies'}</span><span class="tag">${h(k.p.sku)}</span></div><small>${n} secreto${n===1?'':'s'} · soft-delete ${h(k.p.retention)} días${k.p.purgeProtection?' · protección de purga':''}</small></div>`}).join('');
        const loose2=res.filter(r=>(r.t==='nsg'&&!S.res.some(n=>n.t==='nic'&&n.p.nsg===V.resId(r)))||(r.t==='pip'&&r.p.standalone)).map(r=>r.t==='nsg'?`<button class="mini-tag" data-cmd="az network nsg rule list -g ${h(r.rg)} --nsg-name ${h(r.name)} -o table">🛡 NSG ${h(r.name)} · ${V.nsgRules(r).length} regla${V.nsgRules(r).length===1?'':'s'}</button>`:`<span class="mini-tag">🌐 IP pública ${h(r.name)} · ${h(r.p.ip)}</span>`).join('');
        const plans=res.filter(r=>r.t==='plan').map(p=>{const pv=V.planView(p),apps=S.res.filter(w=>w.t==='webapp'&&w.p.plan===V.resId(p));return`<div class="cres azplan${fresh(p)}" data-cmd="az appservice plan list -g ${h(p.rg)} -o table"><div class="cres-h"><span class="kind">App Service plan</span><b>${h(p.name)}</b><span class="tag">${h(pv.sku.name)} · ${h(pv.sku.tier)}</span><span class="tag">${p.p.linux?'Linux':'Windows'}</span></div><div class="azvms">${apps.map(w=>`<button class="azvm st-run${fresh(w)}" data-cmd="az webapp browse -g ${h(w.rg)} -n ${h(w.name)}" title="https://${h(w.name)}.azurewebsites.net"><span class="dot"></span><b>${h(w.name)}</b><small>${h(w.p.runtime||'web app')}</small></button>`).join('')||'<span class="empty-s">Sin web apps. Crea una con <code>az webapp create</code>.</span>'}</div></div>`}).join('');
        const aks=res.filter(r=>r.t==='aks').map(a=>{
          const b=busy(a),on=a.p.power==='Running'&&!b,ctx=S.merged.some(m=>m.id===a.p.uid);
          return`<div class="cres azaks${fresh(a)}" data-cmd="az aks show -g ${h(a.rg)} -n ${h(a.name)} -o table"><div class="cres-h"><span class="kind">AKS</span><b>${h(a.name)}</b><span class="tag">v${h(a.p.version)}</span><span class="ready ${on?'ok':'warn'}">${b?(b==='Creating'?'Creando…':'Eliminando…'):on?'Running':'Stopped'}</span></div><div class="aksnodes">${Array.from({length:a.p.count},(_,i)=>`<span class="aksnode ${on?'st-run':b?'st-wait':'st-off'}" title="aks-nodepool1-…-vmss${String(i).padStart(6,'0')} · ${h(a.p.vmSize)}"><span class="dot"></span>nodo ${i+1}</span>`).join('')}</div><small>${h(a.p.vmSize.replace('Standard_',''))} · grupo de nodos ${h(a.p.nodeRg)}</small><small class="ep ${ctx?'ok':''}">${ctx?'✓ kubectl conectado (contexto en ~/.kube/config)':'kubectl sin conectar: az aks get-credentials'}</small></div>`;
        }).join('');
        const orphans=res.filter(r=>r.p.orphan);
        const support=res.filter(r=>['nic','pip','nsg','disk'].includes(r.t)&&!(r.t==='pip'&&r.p.standalone)&&!(r.t==='nsg'&&!S.res.some(n=>n.t==='nic'&&n.p.nsg===V.resId(r)))).length-orphans.length;
        const empty=!res.length;
        const meta=tagTags(g.tags)+lockTags(V.resId(g))+polTags(V.resId(g))+roleTags(V.resId(g));
        return`<div class="azg${fresh(g)}">${head}${meta?`<div class="conf">${meta}</div>`:''}
${empty?`<p class="empty-s">Grupo vacío. Prueba: <code>az vm create -g ${h(g.name)} -n vm1 --image Ubuntu2204 --size Standard_B1s --generate-ssh-keys</code></p>`:''}${vnets}${loose.length?`<div class="azvms">${loose.map(vmChip).join('')}</div>`:''}${support>0?`<p class="empty-s">+ ${support} recursos de soporte de las VM (NIC, IP pública, NSG, disco)</p>`:''}${loose2?`<div class="conf">${loose2}</div>`:''}${mon?`<div class="conf">${mon}</div>`:''}${storage}${vaults}${sqls}${acrs}${plans}${aks}${orphans.length?`<div class="conf">${orphans.map(r=>`<span class="mini-tag orphan" title="Recurso huérfano: sigue existiendo (y algunos facturan) aunque borraste la VM">⚠ ${h({disk:'Disco',nic:'NIC',pip:'IP pública',nsg:'NSG'}[r.t])} · ${h(r.name.length>26?r.name.slice(0,24)+'…':r.name)}</span>`).join('')}</div>`:''}</div>`;
      }).join('');
      const regions=[...new Set(S.res.filter(r=>inSub(r)&&(r.t==='vm'||r.t==='aks')).map(r=>r.location))];
      const quota=regions.map(l=>{const u=V.usage(l);return`<span class="mini-tag quota${u.total>=10?' full':''}" title="vCPU en uso en ${h(V.disp(l))} (las VM desasignadas no cuentan)">${h(V.disp(l))}: ${u.total}/10 vCPU</span>`}).join('');
      const total=V.spend(),budgets=S.budgets.filter(b=>b.sub===sub.id);
      const money=`<div class="azcost"><span>💲 Coste estimado <b>$${total.toFixed(2)}</b></span><small>${new Date(V.now()).toISOString().slice(0,16).replace('T',' ')} UTC${S.offset?` · reloj +${Math.round(S.offset/3600000)} h`:''}</small></div>${budgets.map(b=>{const pct=Math.min(100,total/b.amount*100);return`<div class="azbudget" title="Presupuesto ${h(b.name)}"><div><span>${h(b.name)} · ${h(b.grain)}</span><b>$${total.toFixed(2)} / $${h(b.amount)}</b></div><i><em style="width:${pct.toFixed(1)}%" class="${pct>=100?'over':pct>=80?'warn':''}"></em></i></div>`}).join('')}`;
      body=`<div class="csec"><div class="azsub"><span class="ico">▲</span><div><b>${h(sub.name)}</b><small>${h(sub.id)} · ${h(sub.offer)}</small></div></div>${money}${(()=>{const sid=`/subscriptions/${sub.id}`,m=lockTags(sid)+polTags(sid)+roleTags(sid)+quota;return m?`<div class="conf">${m}</div>`:''})()}</div><div class="csec"><p class="csec-t">Grupos de recursos</p><div class="cnss">${gHtml||'<p class="empty-s">Aún no hay grupos de recursos. Crea uno: <code>az group create -n rg-cloudlab -l spaincentral</code></p>'}</div></div>`;
    }
    if(fromTimer&&body===this.lastMap)return;
    this.lastMap=body;
    const sc=this.mapEl.scrollTop;
    this.mapEl.innerHTML=body;
    this.mapEl.scrollTop=sc;
  }
  drawRetos(check){
    const S=this.sim.state,V=this.sim.view;
    const x={id:V.resId,rules:V.nsgRules,group:n=>S.res.find(r=>r.t==='group'&&r.name.toLowerCase()===n.toLowerCase()&&!V.busy(r)),res:(t,rg,n)=>S.res.find(r=>r.t===t&&r.rg.toLowerCase()===rg.toLowerCase()&&r.name.toLowerCase()===n.toLowerCase()),all:t=>S.res.filter(r=>r.t===t)};
    const newly=[];
    for(const r of RETOS){let ok=false;try{ok=r.ok(S,x,this.done)}catch{}if(ok&&!this.done[r.id]){this.done[r.id]=Date.now();newly.push(r)}}
    writeJSON(DONE,this.done);
    const n=RETOS.filter(r=>this.done[r.id]).length;
    this.el.querySelector('.retos-count').textContent=`${n}/${RETOS.length} completados`;
    this.retosEl.innerHTML=RETOS.map(r=>`<li class="${this.done[r.id]?'done':''}"><span class="chk">${this.done[r.id]?'✓':''}</span><div><span class="rt">${h(r.t)}</span><button class="link" data-hint>Ver pista</button><code class="hint" hidden>${h(r.hint)}</code></div></li>`).join('');
    if(check&&newly.length)for(const r of newly)this.t.write(`\x1b[1;32m✓ Reto completado:\x1b[0m ${r.t}\n`);
  }
}
function colorize(text,err,warn){
  const lines=text.split('\n');
  return lines.map((l,i)=>{
    if(/^cloudlab:/.test(l))return`\x1b[33m${l}\x1b[0m`;
    if(/^WARNING:/.test(l)||warn)return`\x1b[33m${l}\x1b[0m`;
    if(err)return`\x1b[31m${l}\x1b[0m`;
    if(/^-{2,}(\s+-{2,})*$/.test(l))return`\x1b[2m${l}\x1b[0m`;
    if(i+1<lines.length&&/^-{2,}(\s+-{2,})*$/.test(lines[i+1]))return`\x1b[1m${l}\x1b[0m`;
    if(/^(NAME|NAMESPACE|CURRENT)\s/.test(l))return`\x1b[1m${l}\x1b[0m`;
    if(/^Merged ".*" as current context/.test(l)||/ (created|scaled|deleted|configured|exposed)$/.test(l)||/^Switched to context/.test(l))return`\x1b[32m${l}\x1b[0m`;
    return l;
  }).join('\n');
}
})();
