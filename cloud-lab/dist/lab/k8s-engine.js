// Motor de simulación de Kubernetes: estado del clúster, intérprete de comandos (kubectl, minikube y una
// mini shell), errores con el formato de kubectl y autocompletado. No ejecuta nada real.
// Uso: const sim = K8sSim.create({yaml: jsyaml, saved}); sim.run('kubectl get pods') -> {out, code}
(function(root){
'use strict';
const VERSION='v1.37.1';
const MINIKUBE_VERSION='v1.37.0';
const SAFE='bcdfghjklmnpqrstvwxz2456789';
const NAME_RE=/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
const DNS_SUB_RE=/^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/;
const SYSTEM_NS=['kube-system','kube-public','kube-node-lease'];

// ---------- Tipos de recurso ----------
const KINDS={
  Pod:{plural:'pods',singular:'pod',short:['po'],ns:true,api:'v1'},
  Deployment:{plural:'deployments',singular:'deployment',short:['deploy'],ns:true,api:'apps/v1'},
  ReplicaSet:{plural:'replicasets',singular:'replicaset',short:['rs'],ns:true,api:'apps/v1'},
  Service:{plural:'services',singular:'service',short:['svc'],ns:true,api:'v1'},
  ConfigMap:{plural:'configmaps',singular:'configmap',short:['cm'],ns:true,api:'v1'},
  Secret:{plural:'secrets',singular:'secret',short:[],ns:true,api:'v1'},
  Namespace:{plural:'namespaces',singular:'namespace',short:['ns'],ns:false,api:'v1'},
  Node:{plural:'nodes',singular:'node',short:['no'],ns:false,api:'v1'},
  Event:{plural:'events',singular:'event',short:['ev'],ns:true,api:'v1'},
};
// Recursos que existen en Kubernetes pero no se simulan (para dar un mensaje honesto).
const KNOWN_UNSIMULATED=['statefulsets','sts','daemonsets','ds','jobs','job','cronjobs','cj','ingresses','ing','persistentvolumes','pv','persistentvolumeclaims','pvc','storageclasses','sc','serviceaccounts','sa','roles','rolebindings','clusterroles','clusterrolebindings','networkpolicies','netpol','horizontalpodautoscalers','hpa','endpoints','ep','endpointslices','limitranges','limits','resourcequotas','quota','poddisruptionbudgets','pdb','customresourcedefinitions','crd','crds','leases','priorityclasses','pc','ingressclasses','persistentvolume','persistentvolumeclaim','ingress','statefulset','daemonset','cronjob','serviceaccount','role','rolebinding','networkpolicy'];
const KIND_BY_NAME={};
for(const [k,v] of Object.entries(KINDS)){for(const n of [v.plural,v.singular,...v.short,k.toLowerCase()])KIND_BY_NAME[n]=k}
const resolveKind=t=>{const s=String(t||'').toLowerCase();return KIND_BY_NAME[s]||KIND_BY_NAME[s.split('.')[0]]||null};

// Imágenes conocidas: con cualquier otra el Pod falla al descargar la imagen (ErrImagePull), como ocurre con un nombre mal escrito.
const KNOWN_IMAGES=['nginx','httpd','apache','redis','memcached','postgres','mysql','mariadb','mongo','rabbitmq','busybox','alpine','ubuntu','debian','centos','fedora','node','python','golang','openjdk','eclipse-temurin','tomcat','traefik','caddy','haproxy','wordpress','ghost','grafana/grafana','prom/prometheus','registry','hello-world','nicolaka/netshoot','curlimages/curl','jenkins/jenkins','elasticsearch','kibana','consul','vault','nats','php','ruby','rust','perl','bitnami/nginx','bitnami/redis','gcr.io/google-samples/hello-app','k8s.gcr.io/echoserver','registry.k8s.io/echoserver','hashicorp/http-echo','kennethreitz/httpbin','mcr.microsoft.com/dotnet/aspnet','mcr.microsoft.com/azuredocs/aks-helloworld','nginxdemos/hello','paulbouwer/hello-kubernetes','stefanprodan/podinfo','ealen/echo-server','k8s.gcr.io/pause','registry.k8s.io/pause'];
const ONE_SHOT=['busybox','alpine','ubuntu','debian','centos','fedora','hello-world','curlimages/curl','nicolaka/netshoot','python','node','golang','perl','ruby','php'];
// Registros de Azure Container Registry (los publica la terminal de Azure). acrPull(img) dice si el clúster actual puede descargarla.
let acrPull=()=>'unauthorized';
function imageInfo(image){
  const img=String(image||'');
  if(!/^[a-z0-9]([a-z0-9._\/:-]*[a-z0-9])?(@sha256:[a-f0-9]{64})?$/.test(img))return{valid:false,invalidRef:true};
  let repo=img.split('@')[0];
  const lastColon=repo.lastIndexOf(':');
  let tag='latest';
  if(lastColon>repo.lastIndexOf('/')){tag=repo.slice(lastColon+1);repo=repo.slice(0,lastColon)}
  const bare=repo.replace(/^docker\.io\//,'').replace(/^library\//,'');
  if(/^[a-z0-9]+\.azurecr\.io\//.test(bare)){const r=acrPull(`${bare}:${tag}`);return{valid:r==='ok',repo:bare,tag,acr:r,oneShot:false}}
  const known=KNOWN_IMAGES.includes(bare)||/^(mcr\.microsoft\.com|registry\.k8s\.io|k8s\.gcr\.io|gcr\.io|quay\.io|ghcr\.io|public\.ecr\.aws)\//.test(bare);
  const badTag=/(notexist|doesnotexist|nonexistent|invalid|xyz)/.test(tag);
  return{valid:known&&!badTag,repo:bare,tag,oneShot:ONE_SHOT.includes(bare)};
}

// ---------- Utilidades ----------
const pad=(s,n)=>String(s)+' '.repeat(Math.max(0,n-String(s).length));
function table(rows){
  if(!rows.length)return'';
  const w=rows[0].map((_,i)=>Math.max(...rows.map(r=>String(r[i]).length)));
  return rows.map(r=>r.map((c,i)=>i===r.length-1?String(c):pad(c,w[i]+3)).join('').replace(/\s+$/,'')).join('\n');
}
function age(ms){
  const s=Math.max(0,Math.floor(ms/1000));
  if(s<120)return`${s}s`;
  const m=Math.floor(s/60);
  if(m<10)return`${m}m${s%60?s%60+'s':''}`;
  if(m<180)return`${m}m`;
  const h=Math.floor(m/60);
  if(h<8)return`${h}h${m%60?m%60+'m':''}`;
  if(h<48)return`${h}h`;
  return`${Math.floor(h/24)}d`;
}
function lev(a,b){
  const d=Array.from({length:a.length+1},(_,i)=>[i]);
  for(let j=1;j<=b.length;j++)d[0][j]=j;
  for(let i=1;i<=a.length;i++)for(let j=1;j<=b.length;j++)d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+(a[i-1]===b[j-1]?0:1));
  return d[a.length][b.length];
}
const suggest=(word,list)=>list.filter(x=>lev(word,x)<=2||(word.length>2&&x.startsWith(word))).sort((a,b)=>lev(word,a)-lev(word,b)).slice(0,3);
const rand=(n)=>Array.from({length:n},()=>SAFE[Math.floor(Math.random()*SAFE.length)]).join('');
function hashStr(s,n=10){
  let h=2166136261;
  for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)>>>0}
  let out='';
  for(let i=0;i<n;i++){out+=SAFE[h%SAFE.length];h=Math.imul(h^(h>>>13),2654435761)>>>0}
  return out;
}
const uid=()=>'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0;return(c==='x'?r:(r&3|8)).toString(16)});
const iso=t=>new Date(t).toISOString().replace(/\.\d{3}Z$/,'Z');
const labelStr=l=>Object.entries(l||{}).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join(',')||'<none>';
const clone=o=>JSON.parse(JSON.stringify(o));
const nameErr=(kind,name,what='metadata.name')=>`The ${kind} "${name}" is invalid: ${what}: Invalid value: "${name}": a lowercase RFC 1123 ${kind==='Namespace'||kind==='Service'?'label':'subdomain'} must consist of lower case alphanumeric characters${kind==='Namespace'||kind==='Service'?" or '-'":", '-' or '.'"}, and must start and end with an alphanumeric character (e.g. ${kind==='Namespace'||kind==='Service'?"'my-name',  or '123-abc'":"'example.com'"}, regex used for validation is '${kind==='Namespace'||kind==='Service'?"[a-z0-9]([-a-z0-9]*[a-z0-9])?":"[a-z0-9]([-a-z0-9]*[a-z0-9])?(\\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*"}')`;
function selMatch(sel,labels){
  if(!sel)return true;
  return sel.split(',').map(s=>s.trim()).filter(Boolean).every(term=>{
    let m;
    if((m=term.match(/^([^!=]+)!=(.*)$/)))return labels[m[1]]!==m[2];
    if((m=term.match(/^([^=]+)==?(.*)$/)))return labels[m[1]]===m[2];
    if(term.startsWith('!'))return!(term.slice(1) in labels);
    return term in labels;
  });
}

class CmdError extends Error{constructor(msg,code=1){super(msg);this.code=code}}
const fail=(m)=>{throw new CmdError(m)};

// ---------- Tokenizador de la mini shell ----------
function tokenize(line){
  const out=[];let cur='',q=null,has=false;
  for(let i=0;i<line.length;i++){
    const c=line[i];
    if(q){if(c===q)q=null;else if(c==='\\'&&q==='"'&&i+1<line.length)cur+=line[++i];else cur+=c;continue}
    if(c==='"'||c==="'"){q=c;has=true;continue}
    if(c==='\\'&&i+1<line.length){cur+=line[++i];has=true;continue}
    if(/\s/.test(c)){if(cur||has){out.push(cur);cur='';has=false}continue}
    const two=line.slice(i,i+2);
    if(two==='&&'||two==='>>'||two==='||'){if(cur||has){out.push(cur);cur='';has=false}out.push({op:two});i++;continue}
    if(c==='|'||c==='>'||c===';'){if(cur||has){out.push(cur);cur='';has=false}out.push({op:c});continue}
    cur+=c;has=true;
  }
  if(q)throw new CmdError('sh: error de sintaxis: comilla sin cerrar');
  if(cur||has)out.push(cur);
  return out;
}
// Divide en cadenas (&&, ;) y tuberías (|) con redirección (> y >>).
function parseLine(line){
  const toks=tokenize(line).filter(t=>!(typeof t==='string'&&/^<<-?['"]?\w+['"]?$/.test(t)));
  const chains=[];let pipeline=[],cmd={args:[],redirect:null},sep=null;
  const endCmd=()=>{pipeline.push(cmd);cmd={args:[],redirect:null}};
  for(let i=0;i<toks.length;i++){
    const t=toks[i];
    if(typeof t==='string'){cmd.args.push(t);continue}
    if(t.op==='>'||t.op==='>>'){const f=toks[++i];if(typeof f!=='string')fail('sh: error de sintaxis cerca de un token inesperado `newline\'');cmd.redirect={file:f,append:t.op==='>>'};continue}
    if(t.op==='|'){if(!cmd.args.length)fail("sh: error de sintaxis cerca de un token inesperado `|'");endCmd();continue}
    if(t.op==='&&'||t.op===';'||t.op==='||'){endCmd();chains.push({pipeline,sep});pipeline=[];sep=t.op;continue}
  }
  endCmd();chains.push({pipeline,sep});
  return chains.filter(c=>c.pipeline.some(p=>p.args.length));
}

// ---------- Definición de comandos de kubectl (flags y ayuda) ----------
const F=(name,type='bool',short=null,desc='')=>({name,type,short,desc});
const COMMON_NS=[F('namespace','string','n','Namespace sobre el que actuar.')];
const OUT=F('output','string','o','Formato de salida: json, yaml, name, wide.');
const DRY=F('dry-run','string',null,'none, server o client. Con client solo muestra el objeto sin crearlo.');
const KCMDS={
  get:{desc:'Muestra uno o varios recursos.',use:'kubectl get [(-o|--output=)json|yaml|name|wide] (TYPE[.VERSION][.GROUP] [NAME | -l label] | TYPE[.VERSION][.GROUP]/NAME ...) [flags]',flags:[...COMMON_NS,OUT,F('all-namespaces','bool','A','Lista los recursos de todos los namespaces.'),F('selector','string','l','Selector de etiquetas (p. ej. -l app=web).'),F('show-labels','bool',null,'Muestra las etiquetas como última columna.'),F('watch','bool','w','Observa los cambios (no simulado: muestra el estado actual).'),F('no-headers','bool',null,'No imprime la cabecera.')],ex:['kubectl get pods','kubectl get pods -o wide','kubectl get deploy,svc -n dev','kubectl get all -A']},
  describe:{desc:'Muestra el detalle de un recurso o grupo de recursos.',use:'kubectl describe (-f FILENAME | TYPE [NAME_PREFIX | -l label] | TYPE/NAME) [flags]',flags:[...COMMON_NS,F('all-namespaces','bool','A'),F('selector','string','l')],ex:['kubectl describe pod web-7d9f','kubectl describe node minikube','kubectl describe deploy web']},
  create:{desc:'Crea un recurso desde un fichero o con un subcomando.',use:'kubectl create -f FILENAME | kubectl create (namespace|deployment|service|configmap|secret) NAME [flags]',flags:[...COMMON_NS,F('filename','string','f','Fichero con el manifiesto.'),DRY,OUT],ex:['kubectl create namespace dev','kubectl create deployment web --image=nginx --replicas=3','kubectl create -f deploy.yaml'],subs:['namespace','deployment','service','configmap','secret']},
  'create namespace':{desc:'Crea un namespace.',use:'kubectl create namespace NAME [--dry-run=server|client|none]',flags:[DRY,OUT],ex:['kubectl create namespace dev']},
  'create deployment':{desc:'Crea un Deployment con el nombre indicado.',use:'kubectl create deployment NAME --image=image -- [COMMAND] [args...]',flags:[...COMMON_NS,F('image','array',null,'Imagen del contenedor (obligatorio).'),F('replicas','int','r','Número de réplicas (por defecto 1).'),F('port','int',null,'Puerto que expone el contenedor.'),DRY,OUT],ex:['kubectl create deployment web --image=nginx','kubectl create deployment web --image=nginx --replicas=3 --port=80']},
  'create service':{desc:'Crea un Service.',use:'kubectl create service (clusterip|nodeport|loadbalancer|externalname) NAME --tcp=port:targetPort',flags:[],ex:['kubectl create service clusterip web --tcp=80:80'],subs:['clusterip','nodeport','loadbalancer','externalname']},
  'create service clusterip':{desc:'Crea un Service ClusterIP.',use:'kubectl create service clusterip NAME [--tcp=<port>:<targetPort>]',flags:[...COMMON_NS,F('tcp','array',null,'Puertos port:targetPort.'),DRY,OUT],ex:['kubectl create service clusterip web --tcp=80:8080']},
  'create service nodeport':{desc:'Crea un Service NodePort.',use:'kubectl create service nodeport NAME [--tcp=port:targetPort] [--node-port=30080]',flags:[...COMMON_NS,F('tcp','array'),F('node-port','int'),DRY,OUT],ex:['kubectl create service nodeport web --tcp=80:80']},
  'create service loadbalancer':{desc:'Crea un Service LoadBalancer.',use:'kubectl create service loadbalancer NAME [--tcp=port:targetPort]',flags:[...COMMON_NS,F('tcp','array'),DRY,OUT],ex:['kubectl create service loadbalancer web --tcp=80:80']},
  'create service externalname':{desc:'Crea un Service ExternalName.',use:'kubectl create service externalname NAME --external-name external.name',flags:[...COMMON_NS,F('external-name','string'),F('tcp','array'),DRY,OUT],ex:['kubectl create service externalname db --external-name db.example.com']},
  'create configmap':{desc:'Crea un ConfigMap desde valores literales o ficheros.',use:'kubectl create configmap NAME [--from-literal=key1=value1] [--from-file=[key=]source]',flags:[...COMMON_NS,F('from-literal','array',null,'Par clave=valor.'),F('from-file','array',null,'Fichero (del sistema de ficheros simulado).'),DRY,OUT],ex:['kubectl create configmap app-config --from-literal=LOG_LEVEL=debug']},
  'create secret':{desc:'Crea un Secret.',use:'kubectl create secret (generic|tls|docker-registry) NAME [flags]',flags:[],ex:['kubectl create secret generic db --from-literal=password=s3cr3t'],subs:['generic','tls','docker-registry']},
  'create secret generic':{desc:'Crea un Secret genérico.',use:'kubectl create secret generic NAME [--from-literal=key1=value1] [--from-file=[key=]source]',flags:[...COMMON_NS,F('from-literal','array'),F('from-file','array'),F('type','string'),DRY,OUT],ex:['kubectl create secret generic db-pass --from-literal=password=s3cr3t']},
  apply:{desc:'Aplica la configuración de un fichero a un recurso (lo crea o lo actualiza).',use:'kubectl apply (-f FILENAME | -k DIRECTORY) [flags]',flags:[...COMMON_NS,F('filename','array','f','Fichero; usa - para leer de la entrada estándar.'),DRY,OUT],ex:['kubectl apply -f deploy.yaml','cat <<EOF | kubectl apply -f -']},
  delete:{desc:'Elimina recursos por nombre, fichero, tipo o selector.',use:'kubectl delete ([-f FILENAME] | TYPE [(NAME | -l label | --all)]) [flags]',flags:[...COMMON_NS,F('filename','array','f'),F('selector','string','l'),F('all','bool'),F('all-namespaces','bool','A'),F('force','bool'),F('grace-period','int'),F('now','bool'),F('wait','bool')],ex:['kubectl delete pod web-7d9f','kubectl delete deploy web','kubectl delete ns dev','kubectl delete -f deploy.yaml']},
  run:{desc:'Crea y ejecuta una imagen concreta en un Pod.',use:'kubectl run NAME --image=image [--env="key=value"] [--port=port] [--restart=Always|Never] [--command] -- [COMMAND] [args...]',flags:[...COMMON_NS,F('image','string',null,'Imagen del contenedor (obligatorio).'),F('port','int'),F('labels','string','l'),F('env','array'),F('restart','string'),F('command','bool'),F('rm','bool'),F('stdin','bool','i'),F('tty','bool','t'),DRY,OUT],ex:['kubectl run nginx --image=nginx','kubectl run tmp --image=busybox --restart=Never -- sleep 3600','kubectl run nginx --image=nginx --dry-run=client -o yaml']},
  scale:{desc:'Cambia el número de réplicas de un Deployment o ReplicaSet.',use:'kubectl scale [--current-replicas=count] --replicas=COUNT (-f FILENAME | TYPE NAME)',flags:[...COMMON_NS,F('replicas','int',null,'Nuevo número de réplicas (obligatorio).'),F('current-replicas','int')],ex:['kubectl scale deployment web --replicas=5','kubectl scale deploy/web --replicas=0']},
  expose:{desc:'Expone un recurso como un nuevo Service.',use:'kubectl expose (-f FILENAME | TYPE NAME) [--port=port] [--target-port=number-or-name] [--name=name] [--type=type]',flags:[...COMMON_NS,F('port','int'),F('target-port','string'),F('name','string'),F('type','string',null,'ClusterIP, NodePort o LoadBalancer.'),F('protocol','string'),F('selector','string'),DRY,OUT],ex:['kubectl expose deployment web --port=80 --type=NodePort','kubectl expose pod nginx --port=80 --name=nginx-svc']},
  logs:{desc:'Muestra los logs de un contenedor de un Pod.',use:'kubectl logs [-f] [-p] (POD | TYPE/NAME) [-c CONTAINER]',flags:[...COMMON_NS,F('container','string','c'),F('follow','bool','f'),F('previous','bool','p'),F('tail','int'),F('timestamps','bool'),F('selector','string','l'),F('all-containers','bool')],ex:['kubectl logs nginx','kubectl logs deploy/web','kubectl logs web-7d9f --tail=20']},
  exec:{desc:'Ejecuta un comando dentro de un contenedor.',use:'kubectl exec (POD | TYPE/NAME) [-c CONTAINER] [flags] -- COMMAND [args...]',flags:[...COMMON_NS,F('container','string','c'),F('stdin','bool','i'),F('tty','bool','t')],ex:['kubectl exec nginx -- ls /usr/share/nginx/html','kubectl exec -it nginx -- env','kubectl exec tmp -- wget -qO- web']},
  label:{desc:'Añade, cambia o quita etiquetas de un recurso.',use:'kubectl label [--overwrite] (-f FILENAME | TYPE NAME) KEY_1=VAL_1 ... KEY_N=VAL_N [--resource-version=version]',flags:[...COMMON_NS,F('overwrite','bool'),F('all','bool'),F('selector','string','l'),F('list','bool')],ex:['kubectl label pod nginx env=dev','kubectl label pod nginx env=prod --overwrite','kubectl label pod nginx env-']},
  annotate:{desc:'Añade o cambia anotaciones de un recurso.',use:'kubectl annotate [--overwrite] (-f FILENAME | TYPE NAME) KEY_1=VAL_1 ...',flags:[...COMMON_NS,F('overwrite','bool'),F('all','bool')],ex:['kubectl annotate deploy web kubernetes.io/change-cause="nginx 1.27"']},
  set:{desc:'Cambia campos concretos de los objetos.',use:'kubectl set SUBCOMMAND',flags:[],ex:['kubectl set image deployment/web nginx=nginx:1.27'],subs:['image','env']},
  'set image':{desc:'Actualiza la imagen de un contenedor (lanza un rolling update).',use:'kubectl set image (-f FILENAME | TYPE NAME) CONTAINER_NAME_1=CONTAINER_IMAGE_1 ...',flags:[...COMMON_NS,F('all','bool')],ex:['kubectl set image deployment/web nginx=nginx:1.27']},
  'set env':{desc:'Actualiza variables de entorno de un Deployment.',use:'kubectl set env (TYPE NAME) KEY_1=VAL_1 ... | KEY-',flags:[...COMMON_NS],ex:['kubectl set env deployment/web LOG_LEVEL=debug']},
  rollout:{desc:'Gestiona el despliegue de un recurso.',use:'kubectl rollout SUBCOMMAND',flags:[],ex:['kubectl rollout status deployment/web','kubectl rollout undo deployment/web'],subs:['status','history','undo','restart','pause','resume']},
  'rollout status':{desc:'Muestra el estado del despliegue.',use:'kubectl rollout status (TYPE NAME | TYPE/NAME) [flags]',flags:[...COMMON_NS,F('watch','bool','w'),F('timeout','string')],ex:['kubectl rollout status deployment/web']},
  'rollout history':{desc:'Muestra las revisiones del despliegue.',use:'kubectl rollout history (TYPE NAME | TYPE/NAME) [--revision=N]',flags:[...COMMON_NS,F('revision','int')],ex:['kubectl rollout history deployment/web']},
  'rollout undo':{desc:'Vuelve a una revisión anterior.',use:'kubectl rollout undo (TYPE NAME | TYPE/NAME) [--to-revision=N]',flags:[...COMMON_NS,F('to-revision','int')],ex:['kubectl rollout undo deployment/web','kubectl rollout undo deployment/web --to-revision=1']},
  'rollout restart':{desc:'Reinicia los Pods de un recurso (nuevo ReplicaSet).',use:'kubectl rollout restart RESOURCE',flags:[...COMMON_NS],ex:['kubectl rollout restart deployment/web']},
  'rollout pause':{desc:'Pausa el despliegue.',use:'kubectl rollout pause RESOURCE',flags:[...COMMON_NS],ex:['kubectl rollout pause deployment/web']},
  'rollout resume':{desc:'Reanuda un despliegue pausado.',use:'kubectl rollout resume RESOURCE',flags:[...COMMON_NS],ex:['kubectl rollout resume deployment/web']},
  config:{desc:'Modifica los ficheros kubeconfig.',use:'kubectl config SUBCOMMAND',flags:[],ex:['kubectl config get-contexts','kubectl config set-context --current --namespace=dev'],subs:['current-context','get-contexts','use-context','set-context','view']},
  'config current-context':{desc:'Muestra el contexto actual.',use:'kubectl config current-context',flags:[],ex:[]},
  'config get-contexts':{desc:'Lista los contextos.',use:'kubectl config get-contexts [NAME]',flags:[],ex:[]},
  'config use-context':{desc:'Cambia el contexto actual.',use:'kubectl config use-context CONTEXT_NAME',flags:[],ex:['kubectl config use-context minikube']},
  'config set-context':{desc:'Cambia un contexto (p. ej. su namespace por defecto).',use:'kubectl config set-context [NAME | --current] [--namespace=namespace]',flags:[F('current','bool'),F('namespace','string')],ex:['kubectl config set-context --current --namespace=dev']},
  'config view':{desc:'Muestra la configuración de kubeconfig.',use:'kubectl config view [--minify]',flags:[F('minify','bool'),OUT],ex:[]},
  cordon:{desc:'Marca un nodo como no programable.',use:'kubectl cordon NODE',flags:[],ex:['kubectl cordon minikube-m02']},
  uncordon:{desc:'Vuelve a marcar un nodo como programable.',use:'kubectl uncordon NODE',flags:[],ex:['kubectl uncordon minikube-m02']},
  drain:{desc:'Vacía un nodo para mantenimiento (lo acordona y desaloja sus Pods).',use:'kubectl drain NODE [--ignore-daemonsets] [--force]',flags:[F('ignore-daemonsets','bool'),F('force','bool'),F('delete-emptydir-data','bool'),F('grace-period','int')],ex:['kubectl drain minikube-m02 --ignore-daemonsets']},
  top:{desc:'Muestra el consumo de CPU y memoria (necesita metrics-server).',use:'kubectl top (node|pod)',flags:[],ex:['kubectl top nodes','kubectl top pods'],subs:['node','pod']},
  'top node':{desc:'Consumo de recursos de los nodos.',use:'kubectl top node [NAME]',flags:[],ex:[]},
  'top pod':{desc:'Consumo de recursos de los Pods.',use:'kubectl top pod [NAME]',flags:[...COMMON_NS,F('all-namespaces','bool','A')],ex:[]},
  'cluster-info':{desc:'Muestra la dirección del plano de control y los servicios del clúster.',use:'kubectl cluster-info',flags:[],ex:[]},
  version:{desc:'Muestra la versión del cliente y del servidor.',use:'kubectl version [--client] [-o json|yaml]',flags:[F('client','bool'),OUT],ex:[]},
  'api-resources':{desc:'Lista los tipos de recurso disponibles.',use:'kubectl api-resources [--namespaced=true|false]',flags:[F('namespaced','string'),OUT],ex:[]},
  explain:{desc:'Documentación de un recurso o de un campo.',use:'kubectl explain TYPE[.FIELD...]',flags:[],ex:['kubectl explain pod','kubectl explain deployment.spec.replicas']},
  events:{desc:'Lista los eventos.',use:'kubectl events [-n NAMESPACE | -A]',flags:[...COMMON_NS,F('all-namespaces','bool','A')],ex:['kubectl events -n dev']},
  'port-forward':{desc:'Reenvía puertos locales a un Pod o Service.',use:'kubectl port-forward TYPE/NAME [LOCAL_PORT:]REMOTE_PORT',flags:[...COMMON_NS,F('address','string')],ex:['kubectl port-forward svc/web 8080:80']},
  auth:{desc:'Inspecciona la autorización.',use:'kubectl auth can-i VERB [TYPE | TYPE/NAME]',flags:[...COMMON_NS,F('all-namespaces','bool','A')],ex:['kubectl auth can-i create pods'],subs:['can-i','whoami']},
  wait:{desc:'Espera a que se cumpla una condición.',use:"kubectl wait (TYPE NAME | TYPE/NAME) --for=condition=Ready [--timeout=60s]",flags:[...COMMON_NS,F('for','string'),F('timeout','string'),F('selector','string','l'),F('all','bool')],ex:['kubectl wait pod/nginx --for=condition=Ready']},
};
// Subcomandos reales de kubectl (docs v1.37) que existen pero no se simulan.
const KUBECTL_ALL=['annotate','api-resources','api-versions','apply','attach','auth','autoscale','certificate','cluster-info','completion','config','cordon','cp','create','debug','delete','describe','diff','drain','edit','events','exec','explain','expose','get','kuberc','kustomize','label','logs','options','patch','plugin','port-forward','proxy','replace','rollout','run','scale','set','taint','top','uncordon','version','wait'];
const SHELL_CMDS=['kubectl','k','minikube','clear','help','history','ls','cat','rm','echo','lab','grep','wc','head','tail','nano','vi','vim','pwd','whoami','date','touch'];

// ---------- Documentación para kubectl explain ----------
const EXPLAIN={
  pod:['Pod','v1','Un Pod es una colección de contenedores que se ejecutan juntos en un nodo. Lo crean los clientes y lo programa el scheduler.',{apiVersion:'<string>',kind:'<string>',metadata:'<ObjectMeta>',spec:'<PodSpec>',status:'<PodStatus>'}],
  'pod.spec':['Pod','v1','Especificación del comportamiento deseado del Pod.',{containers:'<[]Container> -required-',nodeName:'<string>',restartPolicy:'<string> (Always, OnFailure, Never)',volumes:'<[]Volume>',nodeSelector:'<map[string]string>'}],
  'pod.spec.containers':['Pod','v1','Lista de contenedores del Pod. Debe haber al menos uno.',{name:'<string> -required-',image:'<string>',command:'<[]string>',args:'<[]string>',ports:'<[]ContainerPort>',env:'<[]EnvVar>',resources:'<ResourceRequirements>',livenessProbe:'<Probe>',readinessProbe:'<Probe>'}],
  deployment:['Deployment','apps/v1','Un Deployment permite actualizaciones declarativas de Pods y ReplicaSets.',{apiVersion:'<string>',kind:'<string>',metadata:'<ObjectMeta>',spec:'<DeploymentSpec>',status:'<DeploymentStatus>'}],
  'deployment.spec':['Deployment','apps/v1','Especificación del comportamiento deseado del Deployment.',{replicas:'<integer>',selector:'<LabelSelector> -required-',template:'<PodTemplateSpec> -required-',strategy:'<DeploymentStrategy>',revisionHistoryLimit:'<integer>',paused:'<boolean>'}],
  'deployment.spec.replicas':['Deployment','apps/v1','Número de Pods deseados. Es un puntero para distinguir entre cero explícito y no especificado. Por defecto, 1.',null],
  'deployment.spec.strategy':['Deployment','apps/v1','Estrategia para reemplazar los Pods existentes por los nuevos.',{type:'<string> (Recreate, RollingUpdate)',rollingUpdate:'<RollingUpdateDeployment>'}],
  replicaset:['ReplicaSet','apps/v1','Un ReplicaSet garantiza que se ejecute un número concreto de réplicas de un Pod en cada momento.',{apiVersion:'<string>',kind:'<string>',metadata:'<ObjectMeta>',spec:'<ReplicaSetSpec>',status:'<ReplicaSetStatus>'}],
  service:['Service','v1','Un Service es una abstracción con nombre de un servicio de software: un puerto local en el que escucha un proxy y un selector que determina qué Pods responden.',{apiVersion:'<string>',kind:'<string>',metadata:'<ObjectMeta>',spec:'<ServiceSpec>',status:'<ServiceStatus>'}],
  'service.spec':['Service','v1','Comportamiento del Service.',{type:'<string> (ClusterIP, ExternalName, LoadBalancer, NodePort)',selector:'<map[string]string>',ports:'<[]ServicePort>',clusterIP:'<string>',externalName:'<string>'}],
  'service.spec.type':['Service','v1','Cómo se expone el Service. Por defecto ClusterIP. Valores válidos: ExternalName, ClusterIP, NodePort y LoadBalancer.',null],
  configmap:['ConfigMap','v1','ConfigMap guarda datos de configuración para que los consuman los Pods.',{apiVersion:'<string>',kind:'<string>',metadata:'<ObjectMeta>',data:'<map[string]string>',binaryData:'<map[string]string>',immutable:'<boolean>'}],
  secret:['Secret','v1','Secret guarda datos sensibles de un tipo concreto, como contraseñas o claves. Los valores se codifican en base64 (no es cifrado).',{apiVersion:'<string>',kind:'<string>',metadata:'<ObjectMeta>',data:'<map[string]string>',stringData:'<map[string]string>',type:'<string>',immutable:'<boolean>'}],
  namespace:['Namespace','v1','Namespace proporciona un ámbito para los nombres. Útil para dividir el clúster entre equipos o entornos.',{apiVersion:'<string>',kind:'<string>',metadata:'<ObjectMeta>',spec:'<NamespaceSpec>',status:'<NamespaceStatus>'}],
  node:['Node','v1','Node es un trabajador del clúster. Cada nodo tiene una caché única (etcd).',{apiVersion:'<string>',kind:'<string>',metadata:'<ObjectMeta>',spec:'<NodeSpec>',status:'<NodeStatus>'}],
  'node.spec':['Node','v1','Comportamiento deseado del nodo.',{unschedulable:'<boolean>',taints:'<[]Taint>',podCIDR:'<string>'}],
};

// ---------- Simulador ----------
function create(opts={}){
  const yaml=opts.yaml||root.jsyaml;
  const now=opts.now||(()=>Date.now());
  let S;

  // reset=true en "lab reset": los contextos AKS antiguos se conservan pero no vuelven a ser el actual.
  function fresh(reset){
    const t=now()-1000*60*4;
    S={v:1,createdAt:t,savedAt:now(),seq:0,ipSeq:{},svcSeq:2,running:true,
      addons:{'metrics-server':false,'dashboard':false,'ingress':false},
      ctx:{current:'minikube',contexts:{minikube:{cluster:'minikube',user:'minikube',namespace:'default'}}},
      items:[],events:[],files:{},history:[],cluster:'minikube',parked:{},aksAt:reset?now():0};
    addNode('minikube',true,t);
    for(const n of ['default',...SYSTEM_NS])put({kind:'Namespace',name:n,created:t,labels:{'kubernetes.io/metadata.name':n}});
    put({kind:'Service',namespace:'default',name:'kubernetes',created:t,labels:{component:'apiserver',provider:'kubernetes'},spec:{type:'ClusterIP',clusterIP:'10.96.0.1',ports:[{name:'https',port:443,targetPort:8443,protocol:'TCP'}],selector:null}});
    const sys=[['coredns-'+hashStr('coredns',10)+'-'+hashStr('cd1',5),'registry.k8s.io/coredns/coredns:v1.12.1',{'k8s-app':'kube-dns'}],['etcd-minikube','registry.k8s.io/etcd:3.6.4-0',{component:'etcd',tier:'control-plane'}],['kube-apiserver-minikube','registry.k8s.io/kube-apiserver:'+VERSION,{component:'kube-apiserver',tier:'control-plane'}],['kube-controller-manager-minikube','registry.k8s.io/kube-controller-manager:'+VERSION,{component:'kube-controller-manager',tier:'control-plane'}],['kube-proxy-'+hashStr('kp',5),'registry.k8s.io/kube-proxy:'+VERSION,{'k8s-app':'kube-proxy'}],['kube-scheduler-minikube','registry.k8s.io/kube-scheduler:'+VERSION,{component:'kube-scheduler',tier:'control-plane'}],['storage-provisioner','gcr.io/k8s-minikube/storage-provisioner:v5',{'integration-test':'storage-provisioner'}]];
    for(const [name,image,labels] of sys){const p=put({kind:'Pod',namespace:'kube-system',name,created:t,labels,spec:{containers:[{name:name.split('-')[0]==='kube'?name.replace(/-minikube$/,'').replace(/-[a-z0-9]{5}$/,''):name.split('-')[0],image}],restartPolicy:'Always',nodeName:'minikube',system:true},status:{scheduledAt:t,podIP:'10.244.0.'+(S.seq+1)}});p.status.hostNetwork=/etcd|apiserver|controller|scheduler|proxy/.test(name)}
    for(const n of ['default',...SYSTEM_NS])put({kind:'ConfigMap',namespace:n,name:'kube-root-ca.crt',created:t,data:{'ca.crt':'-----BEGIN CERTIFICATE-----\nMIIDBjCCAe6gAwIBAgIBATANBgkqhkiG9w0BAQsFADAVMRMwEQYDVQQDEwptaW5p\n-----END CERTIFICATE-----'}});
    S.files['README.txt']='Sistema de ficheros simulado. Crea manifiestos con:\n  cat <<EOF > deploy.yaml\n  ...\n  EOF\ny aplícalos con: kubectl apply -f deploy.yaml\n';
  }
  function addNode(name,cp,t=now()){
    const i=S.items.filter(x=>x.kind==='Node').length;
    put({kind:'Node',name,created:t,labels:{'kubernetes.io/hostname':name,'kubernetes.io/os':'linux','kubernetes.io/arch':'amd64',...(cp?{'node-role.kubernetes.io/control-plane':''}:{})},spec:{unschedulable:false,podCIDR:`10.244.${i}.0/24`},status:{ready:true,ip:`192.168.49.${2+i}`,index:i}});
  }
  // ---------- Varios clústeres: minikube + los AKS de la terminal de Azure ----------
  // Los objetos del clúster activo viven en S.items; los demás se aparcan en S.parked.
  // aks = puente escrito por la terminal de Azure: {clusters:[{name,id,rg,location,nodeCount,version,vmSize,fqdn,power,created}], merged:[{context,cluster,user,at}]}.
  const CLUSTER_KEYS=['items','events','running','addons','ipSeq','svcSeq','aksId'];
  let aks=opts.aks||null;
  const aksInfo=name=>((aks&&aks.clusters)||[]).find(c=>c.name===name&&!c.deleted)||null;
  const isAks=()=>S.cluster!=='minikube';
  function useCluster(name){
    if(S.cluster===name)return;
    S.parked[S.cluster]=Object.fromEntries(CLUSTER_KEYS.map(k=>[k,S[k]]));
    const p=S.parked[name],info=aksInfo(name);
    delete S.parked[name];
    if(p&&(name==='minikube'||(info&&p.aksId===info.id)))Object.assign(S,p);
    else freshAks(info);
    S.cluster=name;
  }
  function freshAks(info){
    const t=info.created||now();
    Object.assign(S,{items:[],events:[],running:true,addons:{'metrics-server':true,'dashboard':false,'ingress':false},ipSeq:{},svcSeq:2,aksId:info.id});
    for(const n of ['default',...SYSTEM_NS])put({kind:'Namespace',name:n,created:t,labels:{'kubernetes.io/metadata.name':n}});
    for(const n of ['default',...SYSTEM_NS])put({kind:'ConfigMap',namespace:n,name:'kube-root-ca.crt',created:t,data:{'ca.crt':'-----BEGIN CERTIFICATE-----\nMIIE6DCCAtCgAwIBAgIQ\n-----END CERTIFICATE-----'}});
    put({kind:'Service',namespace:'default',name:'kubernetes',created:t,labels:{component:'apiserver',provider:'kubernetes'},spec:{type:'ClusterIP',clusterIP:'10.0.0.1',ports:[{name:'https',port:443,targetPort:443,protocol:'TCP'}],selector:null}});
    const sys=[['coredns',2,'mcr.microsoft.com/oss/v2/kubernetes/coredns:v1.12.1',{'k8s-app':'kube-dns'}],['coredns-autoscaler',1,'mcr.microsoft.com/oss/v2/kubernetes/autoscaler/cluster-proportional-autoscaler:v1.9.0',{'k8s-app':'coredns-autoscaler'}],['konnectivity-agent',2,'mcr.microsoft.com/oss/v2/kubernetes/apiserver-network-proxy/agent:v0.31.2',{app:'konnectivity-agent'}],['metrics-server',2,'mcr.microsoft.com/oss/v2/kubernetes/metrics-server:v0.8.0',{'k8s-app':'metrics-server'}]];
    let k=0;
    for(const [name,n,image,labels] of sys)for(let i=0;i<n;i++)put({kind:'Pod',namespace:'kube-system',name:`${name}-${hashStr(info.id+name,10)}-${hashStr(info.id+name+i,5)}`,created:t,labels,spec:{containers:[{name:name.split('-')[0]==='coredns'&&name!=='coredns'?'autoscaler':name.split('-')[0]==='konnectivity'?'konnectivity-agent':name,image}],restartPolicy:'Always',nodeName:null,system:true,spread:k++},status:{}});
    syncAksNodes(t);
  }
  const aksNodeName=(info,i)=>`aks-nodepool1-${String(parseInt(hashStr(info.id,6),36)%1e8).padStart(8,'1')}-vmss${String(i).padStart(6,'0')}`;
  // Ajusta los nodos del clúster AKS activo a lo que diga Azure (az aks scale).
  function syncAksNodes(t=now()){
    const info=aksInfo(S.cluster);
    if(!info||!isAks())return;
    const want=info.power==='Running'?info.nodeCount:0;
    let nodes=list('Node').sort((a,b)=>a.status.index-b.status.index);
    for(const n of nodes.slice(want)){for(const p of list('Pod').filter(p=>p.spec.nodeName===n.name&&p.spec.perNode))remove(p);deleteObj(n)}
    for(let i=0;i<want;i++){
      const name=aksNodeName(info,i);
      if(find('Node',name))continue;
      put({kind:'Node',name,created:t,labels:{agentpool:'nodepool1','kubernetes.azure.com/agentpool':'nodepool1','kubernetes.azure.com/cluster':`MC_${info.rg}_${info.name}_${info.location}`,'kubernetes.azure.com/role':'agent','kubernetes.io/arch':'amd64','kubernetes.io/hostname':name,'kubernetes.io/os':'linux','node.kubernetes.io/instance-type':info.vmSize,'topology.kubernetes.io/region':info.location},spec:{unschedulable:false,podCIDR:`10.244.${i}.0/24`},status:{ready:true,ip:`10.224.0.${4+i}`,index:i,aks:true}});
      for(const [ds,image] of [['kube-proxy','mcr.microsoft.com/oss/v2/kubernetes/kube-proxy:v'+info.version],['azure-ip-masq-agent','mcr.microsoft.com/oss/v2/kubernetes/ip-masq-agent:v0.1.15'],['cloud-node-manager','mcr.microsoft.com/oss/v2/kubernetes/azure-cloud-node-manager:v1.33.0'],['csi-azuredisk-node','mcr.microsoft.com/oss/v2/kubernetes-csi/azuredisk-csi:v1.33.0'],['csi-azurefile-node','mcr.microsoft.com/oss/v2/kubernetes-csi/azurefile-csi:v1.33.0']])
        put({kind:'Pod',namespace:'kube-system',name:`${ds}-${hashStr(name+ds,5)}`,created:t,labels:{'k8s-app':ds},spec:{containers:[{name:ds,image}],restartPolicy:'Always',nodeName:name,system:true,perNode:true},status:{scheduledAt:t,podIP:`10.224.0.${4+i}`}});
    }
    // Pods del sistema sin nodo (p. ej. tras arrancar o escalar): se reparten entre los nodos.
    nodes=list('Node');
    if(nodes.length)for(const p of list('Pod','kube-system').filter(p=>p.spec.system&&!p.spec.nodeName)){const n=nodes[(p.spec.spread||0)%nodes.length];p.spec.nodeName=n.name;p.status.scheduledAt=t;p.status.podIP=podIP(n.name)}
    reconcile();
  }
  // Recibe el puente de la terminal de Azure: añade los contextos de "az aks get-credentials".
  function syncAks(bridge){
    if(bridge)aks=bridge;
    for(const m of (aks&&aks.merged)||[]){
      const prev=S.ctx.contexts[m.context];
      S.ctx.contexts[m.context]={cluster:m.cluster,user:m.user,namespace:prev&&prev.cluster===m.cluster?prev.namespace:'default',aks:true};
      if(m.at>(S.aksAt||0)){S.ctx.current=m.context;S.aksAt=m.at}
    }
    syncAksNodes();
  }
  // Una imagen de ACR se descarga si existe en el registro y el clúster AKS actual lo tiene asociado (az aks update --attach-acr).
  acrPull=img=>{
    const reg=img.split('/')[0].split('.')[0],r=((aks&&aks.acr)||[]).find(x=>x.name===reg);
    if(!r)return'unauthorized';
    const i=aksInfo(S.cluster);
    if(!isAks()||!i||!(i.acr||[]).includes(reg))return'unauthorized';
    return r.images.includes(img.replace(/^[^/]+\//,''))?'ok':'notfound';
  };
  const server=()=>{const i=aksInfo(S.cluster);return isAks()&&i?`https://${i.fqdn}:443`:'https://192.168.49.2:8443'};
  const serverVersion=()=>{const i=aksInfo(S.cluster);return isAks()&&i?'v'+i.version:VERSION};
  // Elige el clúster del contexto actual (o de --context). Falla como kubectl si el clúster AKS ya no existe.
  function ensureCluster(ctxName,silent){
    const ctx=S.ctx.contexts[ctxName||S.ctx.current];
    if(!ctx)return;
    const cl=ctx.cluster;
    if(cl!=='minikube'){
      const all=((aks&&aks.clusters)||[]).filter(c=>c.name===cl);
      const info=aksInfo(cl),host=(all[all.length-1]||{fqdn:`${cl}-dns-${hashStr(cl,8)}.hcp.eastus.azmk8s.io`}).fqdn;
      if(!info){if(silent)return;fail(`E1007 12:00:00.000000   memcache.go:265] couldn't get current server API group list: Get "https://${host}:443/api?timeout=32s": dial tcp: lookup ${host} on 127.0.0.53:53: no such host\nUnable to connect to the server: dial tcp: lookup ${host} on 127.0.0.53:53: no such host\ncloudlab: el clúster AKS "${cl}" ya no existe en Azure (¿lo borraste con az aks delete?). Vuelve a minikube con: kubectl config use-context minikube`)}
      if(info.power==='Creating'&&!silent)fail(`Unable to connect to the server: dial tcp: lookup ${info.fqdn} on 127.0.0.53:53: no such host\ncloudlab: el clúster AKS "${cl}" todavía se está creando (--no-wait). Espera un poco y vuelve a intentarlo; míralo con az aks show en la terminal de Azure.`);
      if(info.power==='Stopped'&&!silent)fail(`Unable to connect to the server: dial tcp 20.62.${parseInt(hashStr(cl,2),36)%250}.${parseInt(hashStr(cl+1,2),36)%250}:443: i/o timeout\ncloudlab: el clúster AKS "${cl}" está detenido. Arráncalo en la terminal de Azure con: az aks start -g ${info.rg} -n ${cl}`);
    }
    useCluster(cl);
    syncAksNodes();
  }

  function put(o){
    o.uid=o.uid||uid();o.labels=o.labels||{};o.annotations=o.annotations||{};o.created=o.created||now();o.spec=o.spec||{};o.status=o.status||{};o.rv=++S.seq;
    if(!KINDS[o.kind].ns)delete o.namespace;
    S.items.push(o);return o;
  }
  const find=(kind,name,ns)=>S.items.find(x=>x.kind===kind&&x.name===name&&(!KINDS[kind].ns||x.namespace===ns));
  const list=(kind,ns)=>S.items.filter(x=>x.kind===kind&&(ns==null||!KINDS[kind].ns||x.namespace===ns));
  const remove=o=>{S.items=S.items.filter(x=>x!==o)};
  const curNs=()=>S.ctx.contexts[S.ctx.current].namespace||'default';
  function event(obj,type,reason,msg){
    S.events.push({t:now(),type,reason,msg,kind:obj.kind,name:obj.name,namespace:obj.namespace||'default'});
    if(S.events.length>300)S.events.splice(0,S.events.length-300);
  }

  // ---------- Pods: estado calculado según el tiempo transcurrido ----------
  function podIP(node){
    const idx=(find('Node',node)||{status:{index:0}}).status.index;
    S.ipSeq[idx]=(S.ipSeq[idx]||1)+1;
    return`10.244.${idx}.${S.ipSeq[idx]}`;
  }
  function podView(p){
    const t=now();
    const c=p.spec.containers||[];
    const total=c.length;
    if(p.status.terminatingAt)return{phase:'Running',status:'Terminating',ready:0,total,restarts:0};
    if(!p.spec.nodeName)return{phase:'Pending',status:'Pending',ready:0,total,restarts:0,reason:'Unschedulable'};
    const a=t-(p.status.scheduledAt||p.created);
    if(p.spec.system)return{phase:'Running',status:'Running',ready:total,total,restarts:0};
    if(a<2500)return{phase:'Pending',status:'ContainerCreating',ready:0,total,restarts:0};
    const bad=c.find(x=>!imageInfo(x.image).valid);
    if(bad){
      const inv=imageInfo(bad.image).invalidRef;
      return{phase:'Pending',status:inv?'InvalidImageName':(a<9000?'ErrImagePull':'ImagePullBackOff'),ready:0,total,restarts:0,badImage:bad.image};
    }
    const oneShot=c.find(x=>imageInfo(x.image).oneShot&&!longRunning(x));
    if(oneShot){
      if(p.spec.restartPolicy==='Never'||p.spec.restartPolicy==='OnFailure')return{phase:'Succeeded',status:'Completed',ready:0,total,restarts:0};
      const restarts=Math.min(Math.floor((a-2500)/12000)+1,30);
      return{phase:'Running',status:(Math.floor(a/4000)%3===0)?'Completed':'CrashLoopBackOff',ready:0,total,restarts};
    }
    return{phase:'Running',status:'Running',ready:total,total,restarts:0};
  }
  const isReady=p=>{const v=podView(p);return v.status==='Running'&&v.ready===v.total};
  const longRunning=c=>{const cmd=[...(c.command||[]),...(c.args||[])].join(' ');return/sleep|tail -f|while|infinity|httpd|nginx|server|serve|-l|nc /.test(cmd)};
  function schedule(p){
    const nodes=list('Node').filter(n=>n.status.ready&&!n.spec.unschedulable);
    if(!nodes.length){
      if(!p.status.unschedEvent){event(p,'Warning','FailedScheduling',`0/${list('Node').length} nodes are available: ${list('Node').length} node(s) were unschedulable. preemption: 0/${list('Node').length} nodes are available.`);p.status.unschedEvent=true}
      return false;
    }
    const count=n=>list('Pod').filter(x=>x.spec.nodeName===n.name).length;
    const node=nodes.sort((a,b)=>count(a)-count(b)||a.status.index-b.status.index)[0];
    p.spec.nodeName=node.name;p.status.scheduledAt=now();p.status.podIP=podIP(node.name);delete p.status.unschedEvent;
    event(p,'Normal','Scheduled',`Successfully assigned ${p.namespace}/${p.name} to ${node.name}`);
    for(const c of p.spec.containers){
      const info=imageInfo(c.image);
      if(info.valid){event(p,'Normal','Pulling',`Pulling image "${c.image}"`);event(p,'Normal','Pulled',`Successfully pulled image "${c.image}" in 1.2s`);event(p,'Normal','Created',`Created container: ${c.name}`);event(p,'Normal','Started',`Started container ${c.name}`)}
      else if(info.acr){const reg=info.repo.split('/')[0],repo=info.repo.split('/').slice(1).join('/');event(p,'Normal','Pulling',`Pulling image "${c.image}"`);event(p,'Warning','Failed',info.acr==='unauthorized'?`Failed to pull image "${c.image}": failed to pull and unpack image "${c.image}": failed to resolve reference "${c.image}": failed to authorize: failed to fetch anonymous token: unexpected status from GET request to https://${reg}/oauth2/token?scope=repository%3A${repo}%3Apull&service=${reg}: 401 Unauthorized`:`Failed to pull image "${c.image}": rpc error: code = NotFound desc = failed to pull and unpack image "${c.image}": failed to resolve reference "${c.image}": ${c.image}: not found`);event(p,'Warning','Failed','Error: ErrImagePull')}
      else{event(p,'Normal','Pulling',`Pulling image "${c.image}"`);event(p,'Warning','Failed',`Failed to pull image "${c.image}": Error response from daemon: pull access denied for ${info.repo||c.image}, repository does not exist or may require 'docker login'`);event(p,'Warning','Failed','Error: ErrImagePull')}
    }
    return true;
  }
  function makePod(ns,name,tpl,owner){
    const p=put({kind:'Pod',namespace:ns,name,labels:clone(tpl.labels||{}),annotations:clone(tpl.annotations||{}),spec:{containers:clone(tpl.containers),restartPolicy:tpl.restartPolicy||'Always'},owner});
    schedule(p);return p;
  }

  // ---------- Controladores (Deployment -> ReplicaSet -> Pods) ----------
  function tplHash(t){return hashStr(JSON.stringify({l:t.labels,c:t.containers,a:t.annotations||{}}),10)}
  function reconcile(){
    for(const d of list('Deployment')){
      if(d.spec.paused)continue;
      const h=tplHash(d.spec.template);
      let rs=list('ReplicaSet',d.namespace).find(r=>r.owner&&r.owner.name===d.name&&r.status.hash===h);
      const mine=list('ReplicaSet',d.namespace).filter(r=>r.owner&&r.owner.name===d.name);
      if(!rs){
        d.status.revision=(d.status.revision||0)+1;
        rs=put({kind:'ReplicaSet',namespace:d.namespace,name:`${d.name}-${h}`,labels:{...d.spec.template.labels,'pod-template-hash':h},annotations:{'deployment.kubernetes.io/revision':String(d.status.revision),...(d.annotations['kubernetes.io/change-cause']?{'kubernetes.io/change-cause':d.annotations['kubernetes.io/change-cause']}:{})},spec:{replicas:0,template:clone(d.spec.template)},status:{hash:h},owner:{kind:'Deployment',name:d.name}});
        rs.spec.template.labels={...rs.spec.template.labels,'pod-template-hash':h};
        
      }else if(rs.annotations['deployment.kubernetes.io/revision']!==String(d.status.revision)&&mine.length>1&&rs.spec.replicas===0){
        d.status.revision=(d.status.revision||0)+1;rs.annotations['deployment.kubernetes.io/revision']=String(d.status.revision);
      }
      // Rolling update progresivo (maxSurge 25 % hacia arriba, maxUnavailable 25 % hacia abajo) o Recreate.
      const desired=d.spec.replicas;
      const olds=mine.filter(r=>r!==rs&&r.spec.replicas>0);
      const readyOf=r=>list('Pod',d.namespace).filter(p=>p.owner&&p.owner.name===r.name&&isReady(p)).length;
      const setRS=(r,n)=>{if(r.spec.replicas===n)return;event(d,'Normal','ScalingReplicaSet',`Scaled ${n>r.spec.replicas?'up':'down'} replica set ${r.name} from ${r.spec.replicas} to ${n}`);r.spec.replicas=n};
      if(!olds.length)setRS(rs,desired);
      else if((d.spec.strategy||'RollingUpdate')==='Recreate'){
        olds.forEach(r=>setRS(r,0));
        const oldPods=list('Pod',d.namespace).filter(p=>p.owner&&olds.some(r=>r.name===p.owner.name));
        if(!oldPods.length)setRS(rs,desired);
      }else{
        const surge=Math.max(Math.ceil(desired*.25),desired?0:0)||1,unavail=Math.floor(desired*.25);
        const oldTotal=olds.reduce((a,r)=>a+r.spec.replicas,0);
        setRS(rs,Math.max(rs.spec.replicas,Math.min(desired,desired+surge-oldTotal)));
        // Primero se quitan los Pods viejos que no están listos; luego los listos, sin bajar del mínimo disponible.
        let canRemove=readyOf(rs)+olds.reduce((a,r)=>a+readyOf(r),0)-(desired-unavail);
        for(const r of olds){
          const unready=r.spec.replicas-readyOf(r);
          if(unready>0)setRS(r,r.spec.replicas-unready);
        }
        for(const r of olds.slice().sort((a,b)=>+a.annotations['deployment.kubernetes.io/revision']-+b.annotations['deployment.kubernetes.io/revision'])){
          if(canRemove<=0)break;
          const n=Math.min(canRemove,r.spec.replicas);
          setRS(r,r.spec.replicas-n);canRemove-=n;
        }
        if(rs.spec.replicas>desired)setRS(rs,desired);
      }
      d.status.currentRS=rs.name;
      // Conserva como mucho 10 ReplicaSets antiguos (revisionHistoryLimit).
      const old=mine.filter(r=>r!==rs).sort((a,b)=>+a.annotations['deployment.kubernetes.io/revision']-+b.annotations['deployment.kubernetes.io/revision']);
      while(old.length>10)remove(old.shift());
    }
    for(const rs of list('ReplicaSet')){
      const pods=list('Pod',rs.namespace).filter(p=>p.owner&&p.owner.kind==='ReplicaSet'&&p.owner.name===rs.name&&!p.status.terminatingAt);
      for(let i=pods.length;i<rs.spec.replicas;i++){const p=makePod(rs.namespace,`${rs.name}-${rand(5)}`,rs.spec.template,{kind:'ReplicaSet',name:rs.name});event(rs,'Normal','SuccessfulCreate',`Created pod: ${p.name}`)}
      if(pods.length>rs.spec.replicas){
        const extra=pods.sort((a,b)=>b.created-a.created).slice(0,pods.length-rs.spec.replicas);
        for(const p of extra){remove(p);event(rs,'Normal','SuccessfulDelete',`Deleted pod: ${p.name}`)}
      }
    }
    for(const p of list('Pod'))if(!p.spec.nodeName)schedule(p);
  }

  // ---------- Formato de objetos para -o yaml/json ----------
  function manifest(o){
    const md={name:o.name,...(o.namespace?{namespace:o.namespace}:{}),uid:o.uid,resourceVersion:String(o.rv),creationTimestamp:iso(o.created),...(Object.keys(o.labels).length?{labels:o.labels}:{}),...(Object.keys(o.annotations).length?{annotations:o.annotations}:{})};
    if(o.owner)md.ownerReferences=[{apiVersion:KINDS[o.owner.kind].api,kind:o.owner.kind,name:o.owner.name,controller:true,blockOwnerDeletion:true}];
    const m={apiVersion:KINDS[o.kind].api,kind:o.kind,metadata:md};
    if(o.kind==='Pod'){const v=podView(o);m.spec={containers:o.spec.containers.map(c=>({name:c.name,image:c.image,imagePullPolicy:/:latest$|^[^:]+$/.test(c.image)?'Always':'IfNotPresent',...(c.command?{command:c.command}:{}),...(c.args?{args:c.args}:{}),...(c.ports?{ports:c.ports}:{}),...(c.env?{env:c.env}:{}),resources:c.resources||{}})),restartPolicy:o.spec.restartPolicy,...(o.spec.nodeName?{nodeName:o.spec.nodeName}:{}),schedulerName:'default-scheduler',terminationGracePeriodSeconds:30};m.status={phase:v.phase,...(o.status.podIP?{podIP:o.status.podIP,hostIP:(find('Node',o.spec.nodeName)||{status:{}}).status.ip}:{}),...(o.status.scheduledAt?{startTime:iso(o.status.scheduledAt)}:{}),containerStatuses:o.spec.containers.map(c=>({name:c.name,image:c.image,ready:v.ready===v.total,restartCount:v.restarts,started:v.status==='Running',state:v.status==='Running'?{running:{startedAt:iso(o.status.scheduledAt+2500)}}:{waiting:{reason:v.status}}}))}}
    else if(o.kind==='Deployment'){const st=depStatus(o);m.spec={replicas:o.spec.replicas,selector:{matchLabels:o.spec.selector},strategy:{type:o.spec.strategy||'RollingUpdate',...((o.spec.strategy||'RollingUpdate')==='RollingUpdate'?{rollingUpdate:{maxSurge:'25%',maxUnavailable:'25%'}}:{})},...(o.spec.paused?{paused:true}:{}),revisionHistoryLimit:10,template:{metadata:{labels:o.spec.template.labels,...(o.spec.template.annotations?{annotations:o.spec.template.annotations}:{})},spec:{containers:o.spec.template.containers}}};m.status={observedGeneration:o.status.revision||1,replicas:st.current,updatedReplicas:st.updated,readyReplicas:st.ready,availableReplicas:st.ready}}
    else if(o.kind==='ReplicaSet'){const st=rsStatus(o);m.spec={replicas:o.spec.replicas,selector:{matchLabels:{...o.spec.template.labels}},template:{metadata:{labels:o.spec.template.labels},spec:{containers:o.spec.template.containers}}};m.status={replicas:st.current,readyReplicas:st.ready}}
    else if(o.kind==='Service'){m.spec={type:o.spec.type,...(o.spec.type==='ExternalName'?{externalName:o.spec.externalName}:{clusterIP:o.spec.clusterIP,clusterIPs:[o.spec.clusterIP]}),...(o.spec.selector?{selector:o.spec.selector}:{}),ports:o.spec.ports.map(p=>({...(p.name?{name:p.name}:{}),port:p.port,protocol:p.protocol||'TCP',targetPort:p.targetPort,...(p.nodePort?{nodePort:p.nodePort}:{})}))};m.status={loadBalancer:{}}}
    else if(o.kind==='ConfigMap'){m.data=o.data||{}}
    else if(o.kind==='Secret'){m.data=Object.fromEntries(Object.entries(o.data||{}).map(([k,v])=>[k,b64(v)]));m.type=o.spec.type||'Opaque'}
    else if(o.kind==='Namespace'){m.spec={finalizers:['kubernetes']};m.status={phase:'Active'}}
    else if(o.kind==='Node'){m.spec={podCIDR:o.spec.podCIDR,...(o.spec.unschedulable?{unschedulable:true,taints:[{effect:'NoSchedule',key:'node.kubernetes.io/unschedulable'}]}:{})};m.status={addresses:[{type:'InternalIP',address:o.status.ip},{type:'Hostname',address:o.name}],capacity:{cpu:'2',memory:'3912Mi',pods:'110'},nodeInfo:{kubeletVersion:serverVersion(),containerRuntimeVersion:o.status.aks?'containerd://2.0.0':'docker://28.4.0',osImage:'Ubuntu 22.04.5 LTS',architecture:'amd64'}}}
    return m;
  }
  const b64=s=>{try{return typeof btoa==='function'?btoa(unescape(encodeURIComponent(s))):Buffer.from(s).toString('base64')}catch{return s}};
  const unb64=s=>{try{return typeof atob==='function'?decodeURIComponent(escape(atob(s))):Buffer.from(s,'base64').toString()}catch{return null}};
  const dumpYaml=o=>yaml.dump(o,{lineWidth:-1,noRefs:true,sortKeys:true,quoteStyle:'double'}).replace(/\n$/,'');
  const sortDeep=o=>Array.isArray(o)?o.map(sortDeep):o&&typeof o==='object'?Object.fromEntries(Object.keys(o).sort().map(k=>[k,sortDeep(o[k])])):o;
  function render(objs,fmt,single){
    if(fmt==='yaml')return single&&objs.length===1?dumpYaml(manifest(objs[0])):dumpYaml({apiVersion:'v1',items:objs.map(manifest),kind:'List',metadata:{resourceVersion:''}});
    if(fmt==='json')return JSON.stringify(sortDeep(single&&objs.length===1?manifest(objs[0]):{apiVersion:'v1',items:objs.map(manifest),kind:'List',metadata:{resourceVersion:''}}),null,4);
    if(fmt==='name')return objs.map(o=>`${KINDS[o.kind].singular}${KINDS[o.kind].api.includes('/')?'.'+KINDS[o.kind].api.split('/')[0]:''}/${o.name}`).join('\n');
    return null;
  }
  function depStatus(d){
    const rss=list('ReplicaSet',d.namespace).filter(r=>r.owner&&r.owner.name===d.name);
    const pods=list('Pod',d.namespace).filter(p=>p.owner&&rss.some(r=>r.name===p.owner.name));
    const cur=pods.filter(p=>p.owner.name===d.status.currentRS);
    const ready=pods.filter(p=>{const v=podView(p);return v.ready===v.total&&v.status==='Running'}).length;
    return{current:pods.length,updated:cur.length,ready,desired:d.spec.replicas};
  }
  function rsStatus(r){
    const pods=list('Pod',r.namespace).filter(p=>p.owner&&p.owner.name===r.name);
    return{current:pods.length,ready:pods.filter(p=>{const v=podView(p);return v.status==='Running'&&v.ready===v.total}).length};
  }
  function endpoints(svc){
    if(!svc.spec.selector)return svc.name==='kubernetes'?[isAks()?'10.224.0.4:443':'192.168.49.2:8443']:[];
    return list('Pod',svc.namespace).filter(p=>selMatch(labelStr(svc.spec.selector).replace('<none>',''),p.labels)&&podView(p).status==='Running'&&p.status.podIP).map(p=>`${p.status.podIP}:${svc.spec.ports[0]?.targetPort??80}`);
  }
  const portStr=s=>s.spec.ports.map(p=>`${p.port}${p.nodePort?':'+p.nodePort:''}/${p.protocol||'TCP'}`).join(',')||'<none>';

  // ---------- Tablas de kubectl get ----------
  function rowsFor(kind,objs,o){
    const t=now(),A=o.allNs,W=o.wide;
    const pre=(x)=>A&&KINDS[kind].ns?[x.namespace]:[];
    const head=(cols)=>[...(A&&KINDS[kind].ns?['NAMESPACE']:[]),...cols,...(o.labels?['LABELS']:[])];
    const lab=x=>o.labels?[labelStr(x.labels)]:[];
    const nm=x=>o.prefix?`${KINDS[kind].singular}${KINDS[kind].api.includes('/')?'.'+KINDS[kind].api.split('/')[0]:''}/${x.name}`:x.name;
    switch(kind){
      case'Pod':return[head(['NAME','READY','STATUS','RESTARTS','AGE',...(W?['IP','NODE','NOMINATED NODE','READINESS GATES']:[])]),...objs.map(p=>{const v=podView(p);return[...pre(p),nm(p),`${v.ready}/${v.total}`,v.status,v.restarts?`${v.restarts} (${age(Math.min(t-p.created,40000))} ago)`:'0',age(t-p.created),...(W?[p.status.podIP||'<none>',p.spec.nodeName||'<none>','<none>','<none>']:[]),...lab(p)]})];
      case'Deployment':return[head(['NAME','READY','UP-TO-DATE','AVAILABLE','AGE',...(W?['CONTAINERS','IMAGES','SELECTOR']:[])]),...objs.map(d=>{const s=depStatus(d);return[...pre(d),nm(d),`${s.ready}/${d.spec.replicas}`,s.updated,s.ready,age(t-d.created),...(W?[d.spec.template.containers.map(c=>c.name).join(','),d.spec.template.containers.map(c=>c.image).join(','),labelStr(d.spec.selector)]:[]),...lab(d)]})];
      case'ReplicaSet':return[head(['NAME','DESIRED','CURRENT','READY','AGE',...(W?['CONTAINERS','IMAGES','SELECTOR']:[])]),...objs.map(r=>{const s=rsStatus(r);return[...pre(r),nm(r),r.spec.replicas,s.current,s.ready,age(t-r.created),...(W?[r.spec.template.containers.map(c=>c.name).join(','),r.spec.template.containers.map(c=>c.image).join(','),labelStr(r.labels)]:[]),...lab(r)]})];
      case'Service':return[head(['NAME','TYPE','CLUSTER-IP','EXTERNAL-IP','PORT(S)','AGE',...(W?['SELECTOR']:[])]),...objs.map(s=>[...pre(s),nm(s),s.spec.type,s.spec.type==='ExternalName'?'<none>':s.spec.clusterIP,s.spec.type==='LoadBalancer'?(s.status.externalIP||'<pending>'):s.spec.type==='ExternalName'?s.spec.externalName:'<none>',portStr(s),age(t-s.created),...(W?[s.spec.selector?labelStr(s.spec.selector):'<none>']:[]),...lab(s)])];
      case'ConfigMap':return[head(['NAME','DATA','AGE']),...objs.map(c=>[...pre(c),nm(c),Object.keys(c.data||{}).length,age(t-c.created),...lab(c)])];
      case'Secret':return[head(['NAME','TYPE','DATA','AGE']),...objs.map(c=>[...pre(c),nm(c),c.spec.type||'Opaque',Object.keys(c.data||{}).length,age(t-c.created),...lab(c)])];
      case'Namespace':return[head(['NAME','STATUS','AGE']),...objs.map(n=>[nm(n),n.status.terminating?'Terminating':'Active',age(t-n.created),...lab(n)])];
      case'Node':return[head(['NAME','STATUS','ROLES','AGE','VERSION',...(W?['INTERNAL-IP','EXTERNAL-IP','OS-IMAGE','KERNEL-VERSION','CONTAINER-RUNTIME']:[])]),...objs.map(n=>[nm(n),(n.status.ready?'Ready':'NotReady')+(n.spec.unschedulable?',SchedulingDisabled':''),'node-role.kubernetes.io/control-plane' in n.labels?'control-plane':'<none>',age(t-n.created),serverVersion(),...(W?[n.status.ip,'<none>','Ubuntu 22.04.5 LTS',n.status.aks?'5.15.0-1092-azure':'6.10.14-linuxkit',n.status.aks?'containerd://2.0.0':'docker://28.4.0']:[]),...lab(n)])];
      case'Event':return[head(['LAST SEEN','TYPE','REASON','OBJECT','MESSAGE']),...objs.map(e=>[...(A?[e.namespace]:[]),age(t-e.t),e.type,e.reason,`${KINDS[e.kind].singular}/${e.name}`,e.msg])];
    }
  }

  // ---------- Parser de flags ----------
  const GLOBAL=[F('namespace','string','n'),F('context','string'),F('help','bool','h'),F('kubeconfig','string'),F('v','int','v')];
  function parseFlags(args,spec,cmdName){
    const all=[...spec,...GLOBAL.filter(g=>!spec.some(s=>s.name===g.name))];
    const flags={},pos=[];let dash=null;
    for(let i=0;i<args.length;i++){
      const a=args[i];
      if(a==='--'){dash=args.slice(i+1);break}
      if(a.startsWith('--')){
        let[name,val]=a.slice(2).split(/=(.*)/s);
        const f=all.find(x=>x.name===name);
        if(!f)fail(`error: unknown flag: --${name}\nSee 'kubectl ${cmdName} --help' for usage.`);
        if(f.type==='bool'){flags[name]=val==null?true:val!=='false';continue}
        if(val==null){val=args[++i];if(val==null)fail(`error: flag needs an argument: --${name}`)}
        setFlag(flags,f,val,cmdName);continue;
      }
      if(a.startsWith('-')&&a.length>1&&!/^-\d/.test(a)){
        const ch=a[1];
        const f=all.find(x=>x.short===ch);
        if(!f)fail(`error: unknown shorthand flag: '${ch}' in ${a}\nSee 'kubectl ${cmdName} --help' for usage.`);
        if(f.type==='bool'){flags[f.name]=true;for(const c of a.slice(2)){const g=all.find(x=>x.short===c);if(!g)fail(`error: unknown shorthand flag: '${c}' in ${a}`);flags[g.name]=true}continue}
        let val=a.slice(2).replace(/^=/,'');
        if(!val){val=args[++i];if(val==null)fail(`error: flag needs an argument: '${ch}' in -${ch}`)}
        setFlag(flags,f,val,cmdName);continue;
      }
      pos.push(a);
    }
    return{flags,pos,dash};
  }
  function setFlag(flags,f,val,cmd){
    if(f.type==='int'){if(!/^-?\d+$/.test(val))fail(`error: invalid argument "${val}" for "${f.short?'-'+f.short+', ':''}--${f.name}" flag: strconv.ParseInt: parsing "${val}": invalid syntax\nSee 'kubectl ${cmd} --help' for usage.`);flags[f.name]=+val}
    else if(f.type==='array'){(flags[f.name]=flags[f.name]||[]).push(val)}
    else flags[f.name]=val;
  }
  function help(key){
    const c=KCMDS[key];
    let s=`${c.desc}\n`;
    if(c.ex&&c.ex.length)s+=`\nExamples:\n${c.ex.map(e=>`  ${e}`).join('\n')}\n`;
    if(c.subs)s+=`\nAvailable Commands:\n${c.subs.map(x=>`  ${pad(x,16)}${(KCMDS[key+' '+x]||{}).desc||''}`).join('\n')}\n`;
    if(c.flags.length)s+=`\nOptions:\n${c.flags.map(f=>`    ${f.short?`-${f.short}, `:''}--${f.name}${f.type!=='bool'?'=':''}${f.type==='int'?'0':f.type==='bool'?'':"''"}:\n\t${f.desc||''}`).join('\n\n')}\n`;
    return s+`\nUsage:\n  ${c.use}`;
  }
  function nsOf(flags){
    const ns=flags.namespace||curNs();
    return ns;
  }
  function requireNs(ns){if(!find('Namespace',ns))fail(`Error from server (NotFound): namespaces "${ns}" not found`)}
  function checkOutput(fmt){if(fmt&&!['yaml','json','wide','name'].includes(fmt)&&!/^(jsonpath|custom-columns|go-template)/.test(fmt))fail(`error: unable to match a printer suitable for the output format "${fmt}", allowed formats are: custom-columns,custom-columns-file,go-template,go-template-file,json,jsonpath,jsonpath-as-json,jsonpath-file,name,template,templatefile,wide,yaml`)}
  function typeOrFail(t){
    const k=resolveKind(t);
    if(!k){
      if(KNOWN_UNSIMULATED.includes(String(t).toLowerCase().split('.')[0]))fail(`cloudlab: el tipo de recurso "${t}" existe en Kubernetes, pero todavía no está disponible en este simulador.\nRecursos simulados: pods, deployments, replicasets, services, configmaps, secrets, namespaces, nodes, events.`);
      fail(`error: the server doesn't have a resource type "${t}"`);
    }
    return k;
  }
  // Acepta "TYPE NAME..." o "TYPE/NAME ...".
  function targets(pos,allowMany=true){
    if(!pos.length)return[];
    if(pos[0].includes('/'))return pos.map(p=>{const[t,n]=p.split('/');if(!n)fail(`error: arguments in resource/name form must have a single resource and name`);return{kind:typeOrFail(t),name:n}});
    const kinds=pos[0].split(',').map(typeOrFail);
    const names=pos.slice(1);
    if(names.some(n=>n.includes('/')))fail('error: there is no need to specify a resource type as a separate argument when passing arguments in resource/name form (e.g. \'kubectl get resource/<resource_name>\' instead of \'kubectl get resource resource/<resource_name>\')');
    if(!allowMany&&kinds.length>1)fail('error: you must specify only one resource');
    return names.length?kinds.flatMap(k=>names.map(n=>({kind:k,name:n}))):kinds.map(k=>({kind:k}));
  }
  const notFound=(kind,name)=>`Error from server (NotFound): ${KINDS[kind].plural}${KINDS[kind].api.includes('/')?'.'+KINDS[kind].api.split('/')[0]:''} "${name}" not found`;
  function getOne(kind,name,ns){const o=find(kind,name,ns);if(!o)fail(notFound(kind,name));return o}

  // ---------- kubectl ----------
  function kubectl(args,stdin){
    if(!args.length||args[0]==='--help'||args[0]==='-h'||args[0]==='help')return kubectlHelp();
    // Flags globales antes del subcomando (p. ej. kubectl -n dev get pods).
    const lead=[];
    while(args.length&&args[0].startsWith('-')){
      const a=args.shift();lead.push(a);
      if(/^(-n|--namespace|--context)$/.test(a)&&args.length)lead.push(args.shift());
    }
    const cmd=args[0];
    if(cmd==='--version'||cmd==='version'&&false)return'';
    if(!KCMDS[cmd]){
      if(KUBECTL_ALL.includes(cmd))return info(`cloudlab: "kubectl ${cmd}" existe en kubectl ${VERSION}, pero todavía no se simula aquí.\nEscribe "kubectl --help" para ver los comandos disponibles.`);
      const s=suggest(cmd,Object.keys(KCMDS).filter(k=>!k.includes(' ')));
      fail(`error: unknown command "${cmd}" for "kubectl"${s.length?`\n\nDid you mean this?\n${s.map(x=>'\t'+x).join('\n')}`:''}\n\nRun 'kubectl --help' for usage.`);
    }
    let key=cmd,rest=args.slice(1);
    while(KCMDS[key].subs&&rest.length&&!rest[0].startsWith('-')){
      const sub=rest[0]==='ns'&&key==='create'?'namespace':rest[0]==='deploy'&&key==='create'?'deployment':rest[0]==='svc'&&key==='create'?'service':rest[0]==='cm'&&key==='create'?'configmap':rest[0]==='nodes'||rest[0]==='no'?'node':rest[0]==='pods'||rest[0]==='po'?'pod':rest[0];
      if(KCMDS[`${key} ${sub}`]){key=`${key} ${sub}`;rest=rest.slice(1)}
      else break;
    }
    rest=[...lead,...rest];
    if(rest.includes('--help')||rest.includes('-h'))return help(key);
    const spec=KCMDS[key];
    if(spec.subs&&!['create','apply'].includes(key)&&!rest.some(r=>!r.startsWith('-'))&&key!=='create')return help(key);
    const {flags,pos,dash}=parseFlags(rest,spec.flags,key);
    if(flags.context&&!S.ctx.contexts[flags.context])fail(`error: context "${flags.context}" does not exist`);
    const offline=['config','config current-context','config get-contexts','config use-context','config set-context','config view','explain','api-resources'].includes(key)||(key==='version'&&flags.client);
    ensureCluster(flags.context,offline);
    if(!S.running&&!['config','config current-context','config get-contexts','config use-context','config set-context','config view','version','explain','api-resources'].includes(key)||(!S.running&&key==='version'&&!flags.client))fail(`E1007 12:00:00.000000   memcache.go:265] couldn't get current server API group list: Get "https://192.168.49.2:8443/api?timeout=32s": dial tcp 192.168.49.2:8443: connect: connection refused\nThe connection to the server 192.168.49.2:8443 was refused - did you specify the right host or port?`);
    const fn=HANDLERS[key];
    if(!fn)return help(key);
    const out=fn({flags,pos,dash,stdin,key});
    reconcile();
    if(key==='config use-context')ensureCluster(null,true);
    return out;
  }
  const info=s=>({out:s,code:0});
  function kubectlHelp(){
    const groups=[['Basic Commands (Beginner)',['create','expose','run','set']],['Basic Commands (Intermediate)',['explain','get','delete']],['Deploy Commands',['rollout','scale']],['Cluster Management Commands',['cluster-info','top','cordon','uncordon','drain']],['Troubleshooting and Debugging Commands',['describe','logs','exec','port-forward','events']],['Advanced Commands',['apply','wait']],['Settings Commands',['label','annotate']],['Other Commands',['api-resources','config','version','auth']]];
    return`kubectl controls the Kubernetes cluster manager.\n\n Find more information at: https://kubernetes.io/docs/reference/kubectl/\n\n${groups.map(([g,cs])=>`${g}:\n${cs.map(c=>`  ${pad(c,15)}${KCMDS[c].desc}`).join('\n')}`).join('\n\n')}\n\nUsage:\n  kubectl [flags] [options]\n\nUse "kubectl <command> --help" for more information about a given command.`;
  }

  function dryRunOut(flags,obj){
    if(flags['dry-run']&&!['client','server','none'].includes(flags['dry-run']))fail(`error: Invalid dry-run value (${flags['dry-run']}). Must be "none", "server", or "client".`);
    if(!flags['dry-run']||flags['dry-run']==='none')return null;
    const m=manifest(obj);
    delete m.metadata.uid;delete m.metadata.resourceVersion;m.metadata.creationTimestamp=null;
    if(!flags.namespace||!KINDS[obj.kind].ns)delete m.metadata.namespace;
    const ctr=c=>({...(c.args?{args:c.args}:{}),...(c.command?{command:c.command}:{}),...(c.env?{env:c.env}:{}),image:c.image,name:c.name,...(c.ports?{ports:c.ports.map(p=>({containerPort:p.containerPort}))}:{}),resources:{}});
    if(obj.kind==='Pod')m.spec={containers:obj.spec.containers.map(ctr),dnsPolicy:'ClusterFirst',restartPolicy:obj.spec.restartPolicy};
    if(obj.kind==='Deployment')m.spec={replicas:obj.spec.replicas,selector:{matchLabels:obj.spec.selector},strategy:{},template:{metadata:{creationTimestamp:null,labels:obj.spec.template.labels},spec:{containers:obj.spec.template.containers.map(ctr)}}};
    if(obj.kind==='Service'){m.spec={ports:obj.spec.ports.map(p=>({name:p.name||`${p.port}-${p.targetPort}`,port:p.port,protocol:'TCP',targetPort:p.targetPort})),selector:obj.spec.selector||undefined,type:obj.spec.type};if(!m.spec.selector)delete m.spec.selector;m.status={loadBalancer:{}}}
    else m.status={};
    if(obj.kind==='Namespace')m.spec={};
    if(obj.kind==='ConfigMap'||obj.kind==='Secret')delete m.status;
    if(flags.output==='yaml')return dumpYaml(m);
    if(flags.output==='json')return JSON.stringify(sortDeep(m),null,4);
    return`${KINDS[obj.kind].singular}${KINDS[obj.kind].api.includes('/')?'.'+KINDS[obj.kind].api.split('/')[0]:''}/${obj.name} created (${flags['dry-run']} dry run)`;
  }
  const draft=o=>({uid:'',labels:{},annotations:{},spec:{},status:{},rv:0,created:now(),...o});
  const created=(o,verb='created')=>`${KINDS[o.kind].singular}${KINDS[o.kind].api.includes('/')?'.'+KINDS[o.kind].api.split('/')[0]:''}/${o.name} ${verb}`;
  function checkName(kind,name){
    const re=kind==='Namespace'||kind==='Service'?NAME_RE:DNS_SUB_RE;
    if(!re.test(name)||name.length>(kind==='Namespace'||kind==='Service'?63:253))fail(nameErr(kind,name));
  }
  function exists(kind,name,ns){if(find(kind,name,ns))fail(`Error from server (AlreadyExists): ${KINDS[kind].plural}${KINDS[kind].api.includes('/')?'.'+KINDS[kind].api.split('/')[0]:''} "${name}" already exists`)}
  function needName(pos,usage){if(pos.length!==1)fail(`error: exactly one NAME is required, got ${pos.length}\nSee '${usage}' for usage.`)}

  // Crea objetos (lo usan create, run, expose y apply).
  function createDeployment(ns,name,containers,replicas,labels,extra={}){
    const sel=extra.selector||{app:name};
    return put({kind:'Deployment',namespace:ns,name,labels:labels||{app:name},annotations:extra.annotations||{},spec:{replicas,selector:sel,strategy:extra.strategy,template:{labels:extra.tplLabels||{...sel},containers}},status:{revision:0}});
  }
  function allocIP(){S.svcSeq=(S.svcSeq||2)+1;return`10.${96+Math.floor(S.svcSeq/250)%4}.${Math.floor(Math.random()*250)+1}.${S.svcSeq%250+1}`}
  function nodePort(){let p;do{p=30000+Math.floor(Math.random()*2768)}while(list('Service').some(s=>s.spec.ports.some(x=>x.nodePort===p)));return p}
  function createService(ns,name,type,ports,selector,extra={}){
    const s=put({kind:'Service',namespace:ns,name,labels:extra.labels||{app:name},spec:{type,selector,ports:ports.map(p=>({...p,...(type==='NodePort'||type==='LoadBalancer'?{nodePort:p.nodePort||nodePort()}:{})})),clusterIP:type==='ExternalName'?null:allocIP(),externalName:extra.externalName}});
    if(type==='LoadBalancer')event(s,'Normal','EnsuringLoadBalancer','Ensuring load balancer');
    return s;
  }
  function parseTcp(list){
    return(list||[]).map(x=>{const m=String(x).match(/^(\d+)(?::(\d+))?$/);if(!m)fail(`error: parsing "${x}": invalid port format; expected <port>:<targetPort>`);return{name:`${m[1]}-${m[2]||m[1]}`,port:+m[1],targetPort:+(m[2]||m[1]),protocol:'TCP'}});
  }
  function literals(listVals,cmd){
    const data={};
    for(const l of listVals||[]){const i=l.indexOf('=');if(i<1)fail(`error: invalid literal source ${l}, expected key=value`);data[l.slice(0,i)]=l.slice(i+1)}
    return data;
  }
  function fromFiles(listVals,data){
    for(const f of listVals||[]){const[k,p]=f.includes('=')?f.split(/=(.*)/s):[f.split('/').pop(),f];if(!(p in S.files))fail(`error: error reading ${p}: no such file or directory`);data[k]=S.files[p]}
    return data;
  }

  const HANDLERS={
    get({flags,pos}){
      checkOutput(flags.output);
      if(!pos.length)fail(`You must specify the type of resource to get. Use "kubectl api-resources" for a complete list of supported resources.\n\nerror: Required resource not specified.\nUse "kubectl explain <resource>" for a detailed description of that resource (e.g. kubectl explain pods).\nSee 'kubectl get -h' for help and examples`);
      const allNs=!!flags['all-namespaces'];
      const ns=nsOf(flags);
      if(!allNs&&flags.namespace&&!find('Namespace',ns)&&!pos[0].startsWith('n'))return{out:`No resources found in ${ns} namespace.`,code:0};
      let tg;
      if(pos[0]==='all'){tg=['Pod','Service','Deployment','ReplicaSet'].map(k=>({kind:k}));if(pos.length>1)fail('error: you must specify the resource type when passing names with "all"')}
      else tg=targets(pos);
      const named=tg.some(t=>t.name);
      if(named&&allNs)fail('error: a resource cannot be retrieved by name across all namespaces');
      const errs=[],groups=[];
      const kinds=[...new Set(tg.map(t=>t.kind))];
      for(const kind of kinds){
        let objs;
        if(kind==='Event'){objs=S.events.filter(e=>allNs||e.namespace===ns).slice().reverse().slice(0,60).reverse()}
        else if(named){objs=[];for(const t of tg.filter(t=>t.kind===kind)){const o=find(kind,t.name,ns);if(o)objs.push(o);else errs.push(notFound(kind,t.name))}}
        else objs=list(kind,allNs?null:ns).filter(o=>selMatch(flags.selector,o.labels));
        objs.sort((a,b)=>(a.namespace||'').localeCompare(b.namespace||'')||(a.name||'').localeCompare(b.name||''));
        groups.push({kind,objs});
      }
      const found=groups.flatMap(g=>g.objs);
      let out='';
      const r=render(found.filter(o=>o.kind!==undefined&&KINDS[o.kind]&&o.uid),flags.output,named&&found.length===1);
      if(r!==null&&kinds[0]!=='Event')out=found.length?r:(flags.output==='name'?'':r);
      else{
        const multi=groups.filter(g=>g.objs.length).length>1||pos[0]==='all'||pos[0].includes(',');
        out=groups.filter(g=>g.objs.length).map(g=>{let rows=rowsFor(g.kind,g.objs,{allNs,wide:flags.output==='wide',labels:flags['show-labels'],prefix:multi});if(flags['no-headers'])rows=rows.slice(1);return table(rows)}).join('\n\n');
      }
      if(flags.watch)out+=`${out?'\n':''}cloudlab: -w (watch) no se simula; se muestra el estado actual. Repite el comando para ver cambios.`;
      if(!found.length&&!errs.length)return{out:allNs?'No resources found':KINDS[kinds[0]].ns?`No resources found in ${ns} namespace.`:'No resources found',code:0};
      if(errs.length)return{out:[out,...errs].filter(Boolean).join('\n'),code:1,err:true};
      return out;
    },
    describe({flags,pos}){
      if(!pos.length)fail(`You must specify the type of resource to describe. Use "kubectl api-resources" for a complete list of supported resources.`);
      const ns=nsOf(flags);
      const tg=targets(pos);
      const out=[];
      for(const t of tg){
        let objs;
        if(t.name){objs=list(t.kind,flags['all-namespaces']?null:ns).filter(o=>o.name===t.name);if(!objs.length)objs=list(t.kind,ns).filter(o=>o.name.startsWith(t.name));if(!objs.length)fail(notFound(t.kind,t.name))}
        else objs=list(t.kind,flags['all-namespaces']?null:ns).filter(o=>selMatch(flags.selector,o.labels));
        if(!objs.length)return{out:`No resources found in ${ns} namespace.`,code:0};
        out.push(...objs.map(describeObj));
      }
      return out.join('\n\n\n');
    },
    'create'({flags,stdin}){
      if(!flags.filename)fail(`error: must specify one of -f and -k\n\nCreate a resource from a file or from stdin.\n\n JSON and YAML formats are accepted.\n\nExamples:\n  kubectl create -f ./pod.json\n  kubectl create namespace dev\n  kubectl create deployment web --image=nginx\n\nAvailable Commands:\n  configmap   Create a config map from a local file, directory or literal value\n  deployment  Create a deployment with the specified name\n  namespace   Create a namespace with the specified name\n  secret      Create a secret using a specified subcommand\n  service     Create a service using a specified subcommand`);
      return applyFiles([].concat(flags.filename),flags,stdin,true);
    },
    'create namespace'({flags,pos}){
      needName(pos,'kubectl create namespace -h');
      const name=pos[0];
      const d=dryRunOut(flags,draft({kind:'Namespace',name}));if(d!==null){checkName('Namespace',name);return d}
      checkName('Namespace',name);exists('Namespace',name);
      const n=put({kind:'Namespace',name,labels:{'kubernetes.io/metadata.name':name}});
      put({kind:'ConfigMap',namespace:name,name:'kube-root-ca.crt',data:{'ca.crt':'-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----'}});
      return created(n);
    },
    'create deployment'({flags,pos,dash}){
      needName(pos,'kubectl create deployment -h');
      if(!flags.image)fail(`error: required flag(s) "image" not set`);
      const name=pos[0],ns=nsOf(flags);
      checkName('Deployment',name);
      const replicas=flags.replicas??1;
      if(replicas<0)fail(`The Deployment "${name}" is invalid: spec.replicas: Invalid value: ${replicas}: must be greater than or equal to 0`);
      const containers=flags.image.map(img=>{const ii=imageInfo(img);const cname=(ii.repo||img).split('/').pop().replace(/[^a-z0-9-]/g,'-');return{name:cname,image:img,...(dash&&dash.length?{command:dash}:{}),...(flags.port?{ports:[{containerPort:flags.port,protocol:'TCP'}]}:{})}});
      if(imageInfo(flags.image[0]).invalidRef)fail(`The Deployment "${name}" is invalid: spec.template.spec.containers[0].image: Invalid value: "${flags.image[0]}": must not have leading or trailing whitespace`);
      const d=dryRunOut(flags,draft({kind:'Deployment',namespace:ns,name,labels:{app:name},spec:{replicas,selector:{app:name},template:{labels:{app:name},containers}}}));if(d!==null)return d;
      requireNs(ns);exists('Deployment',name,ns);
      const dep=createDeployment(ns,name,containers,replicas);
      return created(dep);
    },
    'create service clusterip'(a){return createSvcCmd(a,'ClusterIP')},
    'create service nodeport'(a){return createSvcCmd(a,'NodePort')},
    'create service loadbalancer'(a){return createSvcCmd(a,'LoadBalancer')},
    'create service externalname'(a){return createSvcCmd(a,'ExternalName')},
    'create configmap'({flags,pos}){
      needName(pos,'kubectl create configmap -h');
      const name=pos[0],ns=nsOf(flags);checkName('ConfigMap',name);
      const data=fromFiles(flags['from-file'],literals(flags['from-literal']));
      const d=dryRunOut(flags,draft({kind:'ConfigMap',namespace:ns,name,data}));if(d!==null)return d;
      requireNs(ns);exists('ConfigMap',name,ns);
      return created(put({kind:'ConfigMap',namespace:ns,name,data}));
    },
    'create secret generic'({flags,pos}){
      needName(pos,'kubectl create secret generic -h');
      const name=pos[0],ns=nsOf(flags);checkName('Secret',name);
      const data=fromFiles(flags['from-file'],literals(flags['from-literal']));
      const d=dryRunOut(flags,draft({kind:'Secret',namespace:ns,name,data,spec:{type:flags.type||'Opaque'}}));if(d!==null)return d;
      requireNs(ns);exists('Secret',name,ns);
      return created(put({kind:'Secret',namespace:ns,name,data,spec:{type:flags.type||'Opaque'}}));
    },
    apply({flags,stdin}){
      if(!flags.filename)fail('error: must specify one of -f and -k');
      return applyFiles(flags.filename,flags,stdin,false);
    },
    delete({flags,pos}){
      const ns=nsOf(flags);
      if(flags.filename){
        const docs=flags.filename.flatMap(f=>readDocs(f,null));
        return docs.map(m=>{const kind=resolveKind(m.kind);const n=m.metadata&&m.metadata.name;const o=find(kind,n,m.metadata.namespace||ns);if(!o)return{err:notFound(kind,n)};deleteObj(o);return{ok:`${created(o,'deleted')}`}}).map(x=>x.ok||x.err).join('\n');
      }
      if(!pos.length)fail(`error: You must provide one or more resources by argument or filename.\nExample resource specifications include:\n   '-f rsrc.yaml'\n   '--filename=rsrc.json'\n   '<resource> <name>'\n   '<resource>'`);
      const tg=targets(pos);
      const named=tg.some(t=>t.name);
      if(!named&&!flags.all&&!flags.selector)fail(`error: resource(s) were provided, but no name was specified`);
      const out=[];let err=false;
      for(const t of tg){
        const objs=t.name?[find(t.kind,t.name,ns)]:list(t.kind,flags['all-namespaces']?null:ns).filter(o=>selMatch(flags.selector,o.labels)&&!(t.kind==='Namespace'&&['default',...SYSTEM_NS].includes(o.name))&&!(t.kind==='Service'&&o.name==='kubernetes')&&!(t.kind==='ConfigMap'&&o.name==='kube-root-ca.crt'));
        if(t.name&&!objs[0]){out.push(notFound(t.kind,t.name));err=true;continue}
        if(!objs.length){out.push(`No resources found`);continue}
        for(const o of objs){
          if(o.kind==='Namespace'&&['default',...SYSTEM_NS].includes(o.name)){out.push(`Error from server (Forbidden): namespaces "${o.name}" is forbidden: this namespace may not be deleted`);err=true;continue}
          if(o.kind==='Node'&&o.name==='minikube'){out.push(`cloudlab: no puedes borrar el nodo del plano de control "minikube" en este simulador (te quedarías sin clúster). Usa "minikube node delete" para los nodos que añadas.`);err=true;continue}
          deleteObj(o);out.push(created(o,'deleted'));
        }
      }
      if(flags.force&&flags['grace-period']===0)out.unshift('Warning: Immediate deletion does not wait for confirmation that the running resource has been terminated. The resource may continue to run on the cluster indefinitely.');
      return{out:out.join('\n'),code:err?1:0,err};
    },
    run({flags,pos,dash}){
      needName(pos,'kubectl run -h');
      if(!flags.image)fail('error: required flag(s) "image" not set');
      const name=pos[0],ns=nsOf(flags);
      checkName('Pod',name);
      if(imageInfo(flags.image).invalidRef)fail(`error: Invalid image name "${flags.image}": invalid reference format`);
      const restart=flags.restart||'Always';
      if(!['Always','OnFailure','Never'].includes(restart))fail(`error: invalid restart policy: ${restart}`);
      const labels=flags.labels?Object.fromEntries(flags.labels.split(',').map(kv=>kv.split('='))):{run:name};
      const c={name,image:flags.image};
      if(dash&&dash.length){if(flags.command)c.command=dash;else c.args=dash}
      if(flags.port)c.ports=[{containerPort:flags.port}];
      if(flags.env)c.env=flags.env.map(e=>{const[k,v]=e.split(/=(.*)/s);return{name:k,value:v}});
      const d=dryRunOut(flags,draft({kind:'Pod',namespace:ns,name,labels,spec:{containers:[c],restartPolicy:restart}}));if(d!==null)return d;
      requireNs(ns);exists('Pod',name,ns);
      const p=makePod(ns,name,{labels,containers:[c],restartPolicy:restart});
      let out=created(p);
      if(flags.stdin&&flags.tty)out+=`\ncloudlab: las sesiones interactivas (-it) no se simulan. Ejecuta comandos con: kubectl exec ${name} -- <comando>`;
      if(flags.rm)out+=`\ncloudlab: --rm se ignora en el simulador; borra el Pod con kubectl delete pod ${name}`;
      return out;
    },
    scale({flags,pos}){
      if(flags.replicas==null)fail('error: required flag(s) "replicas" not set');
      if(flags.replicas<0)fail('error: The --replicas=COUNT flag is required, and COUNT must be greater than or equal to 0');
      const ns=nsOf(flags);
      const tg=targets(pos,false);
      if(!tg.length||!tg[0].name)fail(`error: resource(s) were provided, but no name was specified`);
      const out=[];
      for(const t of tg){
        if(!['Deployment','ReplicaSet'].includes(t.kind))fail(`error: no objects passed to scale ${KINDS[t.kind].plural} "${t.name}" is not scalable`);
        const o=getOne(t.kind,t.name,ns);
        if(flags['current-replicas']!=null&&o.spec.replicas!==flags['current-replicas'])fail(`error: Expected replicas to be ${flags['current-replicas']}, was ${o.spec.replicas}`);
        if(t.kind==='ReplicaSet'&&o.owner){o.spec.replicas=flags.replicas;out.push(created(o,'scaled'));out.push('cloudlab: este ReplicaSet pertenece a un Deployment, que lo devolverá a su número de réplicas. Escala el Deployment.');continue}
        o.spec.replicas=flags.replicas;out.push(created(o,'scaled'));
      }
      return out.join('\n');
    },
    expose({flags,pos}){
      const ns=nsOf(flags);
      const tg=targets(pos,false);
      if(!tg.length||!tg[0].name)fail(`error: You must provide one or more resources by argument or filename.\nExample resource specifications include:\n   '-f rsrc.yaml'\n   '--filename=rsrc.json'\n   '<resource> <name>'\n   '<resource>'`);
      const t=tg[0];
      if(!['Deployment','Pod','Service','ReplicaSet'].includes(t.kind))fail(`error: cannot expose a ${t.kind}`);
      const o=getOne(t.kind,t.name,ns);
      const type=flags.type||'ClusterIP';
      if(!['ClusterIP','NodePort','LoadBalancer'].includes(type))fail(`The Service "${flags.name||o.name}" is invalid: spec.type: Unsupported value: "${type}": supported values: "ClusterIP", "ExternalName", "LoadBalancer", "NodePort"`);
      const selector=flags.selector?Object.fromEntries(flags.selector.split(',').map(kv=>kv.split('='))):o.kind==='Deployment'?o.spec.selector:o.kind==='Service'?o.spec.selector:Object.fromEntries(Object.entries(o.labels).filter(([k])=>k!=='pod-template-hash'));
      let port=flags.port;
      if(port==null){const cp=(o.kind==='Pod'?o.spec.containers:o.kind==='Service'?[]:o.spec.template.containers).flatMap(c=>c.ports||[])[0];port=cp?cp.containerPort:o.kind==='Service'?o.spec.ports[0].port:null}
      if(port==null)fail(`error: couldn't find port via --port flag or introspection\nSee 'kubectl expose -h' for help and examples`);
      const name=flags.name||o.name;checkName('Service',name);
      const target=flags['target-port']?(/^\d+$/.test(flags['target-port'])?+flags['target-port']:flags['target-port']):port;
      const d=dryRunOut(flags,draft({kind:'Service',namespace:ns,name,labels:clone(o.labels),spec:{type,selector,ports:[{port,targetPort:target,protocol:'TCP'}],clusterIP:''}}));if(d!==null)return d;
      exists('Service',name,ns);
      const s=createService(ns,name,type,[{port,targetPort:target,protocol:'TCP'}],selector,{labels:Object.fromEntries(Object.entries(o.labels).filter(([k])=>k!=='pod-template-hash'))});
      return created(s,'exposed');
    },
    logs({flags,pos}){
      if(!pos.length)fail(`error: expected 'logs [-f] [-p] (POD | TYPE/NAME) [-c CONTAINER]'.\nPOD or TYPE/NAME is a required argument for the logs command\nSee 'kubectl logs -h' for help and examples`);
      const ns=nsOf(flags);
      let p;
      if(pos[0].includes('/')){
        const[t,n]=pos[0].split('/');const k=typeOrFail(t);const o=getOne(k,n,ns);
        if(k==='Pod')p=o;else{const pods=list('Pod',ns).filter(x=>selMatch(labelStr(k==='Deployment'?o.spec.selector:o.labels).replace('<none>',''),x.labels));if(!pods.length)fail(`error: timed out waiting for the condition`);p=pods[0];if(pods.length>1)var note=`Found ${pods.length} pods, using pod/${p.name}`}
      }else p=getOne('Pod',pos[0],ns);
      const c=flags.container?p.spec.containers.find(x=>x.name===flags.container):p.spec.containers[0];
      if(!c)fail(`error: container ${flags.container} is not valid for pod ${p.name}`);
      if(p.spec.containers.length>1&&!flags.container&&!flags['all-containers'])var defNote=`Defaulted container "${c.name}" out of: ${p.spec.containers.map(x=>x.name).join(', ')}`;
      const v=podView(p);
      if(['ContainerCreating','Pending'].includes(v.status))fail(`Error from server (BadRequest): container "${c.name}" in pod "${p.name}" is waiting to start: ContainerCreating`);
      if(/ImagePull|ErrImage|InvalidImage/.test(v.status))fail(`Error from server (BadRequest): container "${c.name}" in pod "${p.name}" is waiting to start: trying and failing to pull image`);
      let lines=fakeLogs(p,c);
      if(flags.tail!=null&&flags.tail>=0)lines=lines.slice(-flags.tail);
      if(flags.timestamps)lines=lines.map((l,i)=>`${iso(p.status.scheduledAt+3000+i*400)} ${l}`);
      let out=[note,defNote,...lines].filter(Boolean).join('\n');
      if(flags.follow)out+='\ncloudlab: -f (seguir los logs) no se simula; se muestran los logs actuales.';
      return out;
    },
    exec({flags,pos,dash}){
      if(!pos.length)fail(`error: pod, type/name or --filename must be specified`);
      const ns=nsOf(flags);
      let p;
      if(pos[0].includes('/')){const[t,n]=pos[0].split('/');const k=typeOrFail(t);const o=getOne(k,n,ns);p=k==='Pod'?o:list('Pod',ns).find(x=>selMatch(labelStr(k==='Deployment'?o.spec.selector:o.labels).replace('<none>',''),x.labels));if(!p)fail('error: no pods found')}
      else p=getOne('Pod',pos[0],ns);
      let cmd=dash||pos.slice(1);
      if(!dash&&pos.length>1)var warn='error: exec [POD] [COMMAND] is not supported anymore. Use exec [POD] -- [COMMAND] instead';
      if(warn)fail(warn);
      if(!cmd.length)fail('error: you must specify at least one command for the container');
      const v=podView(p);
      if(v.status!=='Running')fail(`error: unable to upgrade connection: container not found ("${p.spec.containers[0].name}")`);
      return execIn(p,cmd,flags);
    },
    label({flags,pos}){return labelCmd(flags,pos,'labels','labeled')},
    annotate({flags,pos}){return labelCmd(flags,pos,'annotations','annotated')},
    'set image'({flags,pos}){
      const ns=nsOf(flags);
      const tgPos=pos.filter(p=>!p.includes('=')),pairs=pos.filter(p=>p.includes('='));
      const tg=targets(tgPos,false);
      if(!tg.length||!tg[0].name)fail('error: one or more resources must be specified as <resource> <name> or <resource>/<name>');
      if(!pairs.length)fail('error: at least one image update is required');
      const out=[];
      for(const t of tg){
        const o=getOne(t.kind,t.name,ns);
        const cs=o.kind==='Pod'?o.spec.containers:o.spec.template.containers;
        for(const pr of pairs){
          const[cn,img]=pr.split('=');
          const targetsC=cn==='*'?cs:cs.filter(c=>c.name===cn);
          if(!targetsC.length)fail(`error: unable to find container named "${cn}"`);
          if(imageInfo(img).invalidRef)fail(`error: invalid image name "${img}"`);
          targetsC.forEach(c=>c.image=img);
        }
        if(o.kind==='Deployment')o.annotations['kubernetes.io/change-cause']=undefined,delete o.annotations['kubernetes.io/change-cause'];
        out.push(created(o,'image updated'));
      }
      return out.join('\n');
    },
    'set env'({flags,pos}){
      const ns=nsOf(flags);
      const tg=targets(pos.filter(p=>!p.includes('=')&&!p.endsWith('-')),false);
      const o=getOne(tg[0].kind,tg[0].name,ns);
      if(o.kind!=='Deployment')fail('error: este simulador solo soporta set env sobre Deployments');
      for(const c of o.spec.template.containers){
        c.env=c.env||[];
        for(const kv of pos.filter(p=>p.includes('='))){const[k,v]=kv.split(/=(.*)/s);c.env=c.env.filter(e=>e.name!==k).concat({name:k,value:v})}
        for(const k of pos.filter(p=>p.endsWith('-')&&!p.includes('=')))c.env=c.env.filter(e=>e.name!==k.slice(0,-1));
        if(!c.env.length)delete c.env;
      }
      return created(o,'env updated');
    },
    'rollout status'({flags,pos}){
      const d=depTarget(flags,pos);
      const s=depStatus(d);
      if(d.spec.paused)return`Waiting for deployment "${d.name}" rollout to finish: 0 out of ${d.spec.replicas} new replicas have been updated...\ncloudlab: el despliegue está en pausa (kubectl rollout resume deployment/${d.name}).`;
      if(s.updated===d.spec.replicas&&s.ready===d.spec.replicas&&s.current===d.spec.replicas)return`deployment "${d.name}" successfully rolled out`;
      const waitMsg=s.updated<d.spec.replicas?`${s.updated} out of ${d.spec.replicas} new replicas have been updated...`:s.current>s.updated?`${s.current-s.updated} old replicas are pending termination...`:`${s.ready} of ${s.updated} updated replicas are available...`;
      const bad=list('Pod',d.namespace).filter(p=>p.owner&&p.owner.name===d.status.currentRS).map(podView).find(v=>/ImagePull|ErrImage|CrashLoop|InvalidImage/.test(v.status));
      return{out:`Waiting for deployment "${d.name}" rollout to finish: ${waitMsg}${bad?`\ncloudlab: algún Pod está en ${bad.status}. Revisa con kubectl describe pod o vuelve atrás con kubectl rollout undo deployment/${d.name}.`:'\ncloudlab: el simulador no espera; repite el comando en unos segundos.'}`,code:0};
    },
    'rollout history'({flags,pos}){
      const d=depTarget(flags,pos);
      const rss=list('ReplicaSet',d.namespace).filter(r=>r.owner&&r.owner.name===d.name).sort((a,b)=>+a.annotations['deployment.kubernetes.io/revision']-+b.annotations['deployment.kubernetes.io/revision']);
      if(flags.revision!=null){
        const r=rss.find(x=>x.annotations['deployment.kubernetes.io/revision']===String(flags.revision));
        if(!r)fail(`error: unable to find the specified revision`);
        return`deployment.apps/${d.name} with revision #${flags.revision}\nPod Template:\n  Labels:\t${labelStr(r.spec.template.labels)}\n  Containers:\n${r.spec.template.containers.map(c=>`   ${c.name}:\n    Image:\t${c.image}\n    Port:\t${c.ports?c.ports[0].containerPort+'/TCP':'<none>'}`).join('\n')}`;
      }
      return`deployment.apps/${d.name} \n${table([['REVISION','CHANGE-CAUSE'],...rss.map(r=>[r.annotations['deployment.kubernetes.io/revision'],r.annotations['kubernetes.io/change-cause']||'<none>'])])}`;
    },
    'rollout undo'({flags,pos}){
      const d=depTarget(flags,pos);
      const rss=list('ReplicaSet',d.namespace).filter(r=>r.owner&&r.owner.name===d.name).sort((a,b)=>+b.annotations['deployment.kubernetes.io/revision']-+a.annotations['deployment.kubernetes.io/revision']);
      let target;
      if(flags['to-revision']){target=rss.find(r=>r.annotations['deployment.kubernetes.io/revision']===String(flags['to-revision']));if(!target)fail(`error: unable to find specified revision ${flags['to-revision']} in history`)}
      else{target=rss.find(r=>r.name!==d.status.currentRS);if(!target)fail(`error: no rollout history found for deployment "${d.name}"`)}
      const tpl=clone(target.spec.template);
      tpl.labels=Object.fromEntries(Object.entries(tpl.labels).filter(([k])=>k!=='pod-template-hash'));
      if(tplHash(tpl)===tplHash(d.spec.template))return`deployment.apps/${d.name} skipped rollback (current template already matches revision ${target.annotations['deployment.kubernetes.io/revision']})`;
      d.spec.template=tpl;
      return`deployment.apps/${d.name} rolled back`;
    },
    'rollout restart'({flags,pos}){
      const d=depTarget(flags,pos);
      d.spec.template.annotations={...(d.spec.template.annotations||{}),'kubectl.kubernetes.io/restartedAt':iso(now())};
      return`deployment.apps/${d.name} restarted`;
    },
    'rollout pause'({flags,pos}){const d=depTarget(flags,pos);if(d.spec.paused)fail(`error: deployments.apps "${d.name}" is already paused`);d.spec.paused=true;return`deployment.apps/${d.name} paused`},
    'rollout resume'({flags,pos}){const d=depTarget(flags,pos);if(!d.spec.paused)fail(`error: deployments.apps "${d.name}" is not paused`);d.spec.paused=false;return`deployment.apps/${d.name} resumed`},
    'config current-context'(){return S.ctx.current},
    'config get-contexts'(){return table([['CURRENT','NAME','CLUSTER','AUTHINFO','NAMESPACE'],...Object.entries(S.ctx.contexts).map(([n,c])=>[n===S.ctx.current?'*':'',n,c.cluster,c.user,c.namespace==='default'?'default':c.namespace])])},
    'config use-context'({pos}){if(!pos[0])fail('error: Unexpected args: []\nSee \'kubectl config use-context -h\' for help and examples');if(!S.ctx.contexts[pos[0]])fail(`error: no context exists with the name: "${pos[0]}"`);S.ctx.current=pos[0];return`Switched to context "${pos[0]}".`},
    'config set-context'({flags,pos}){
      const name=flags.current?S.ctx.current:pos[0];
      if(!name)fail('error: you must specify a non-empty context name or --current');
      const exists=!!S.ctx.contexts[name];
      S.ctx.contexts[name]=S.ctx.contexts[name]||{cluster:'minikube',user:'minikube',namespace:'default'};
      if(flags.namespace)S.ctx.contexts[name].namespace=flags.namespace;
      return`Context "${name}" ${exists?'modified':'created'}.${flags.namespace&&!find('Namespace',flags.namespace)?`\ncloudlab: ojo, el namespace "${flags.namespace}" todavía no existe.`:''}`;
    },
    'config view'(){
      const c=S.ctx.contexts;
      return dumpYaml({apiVersion:'v1',clusters:[{cluster:{'certificate-authority':'/home/user/.minikube/ca.crt',server:'https://192.168.49.2:8443'},name:'minikube'},...Object.values(c).filter(x=>x.aks).map(x=>({cluster:{'certificate-authority-data':'DATA+OMITTED',server:`https://${(((aks&&aks.clusters)||[]).filter(k=>k.name===x.cluster).pop()||{fqdn:'?'}).fqdn}:443`},name:x.cluster}))],contexts:Object.entries(c).map(([n,x])=>({context:{cluster:x.cluster,namespace:x.namespace,user:x.user},name:n})),'current-context':S.ctx.current,kind:'Config',users:[{name:'minikube',user:{'client-certificate':'/home/user/.minikube/profiles/minikube/client.crt','client-key':'/home/user/.minikube/profiles/minikube/client.key'}},...Object.values(c).filter(x=>x.aks).map(x=>({name:x.user,user:{'client-certificate-data':'DATA+OMITTED','client-key-data':'DATA+OMITTED',token:'REDACTED'}}))]});
    },
    cordon({pos}){const n=nodeArg(pos);if(n.spec.unschedulable)return`node/${n.name} already cordoned`;n.spec.unschedulable=true;event(n,'Normal','NodeNotSchedulable',`Node ${n.name} status is now: NodeNotSchedulable`);return`node/${n.name} cordoned`},
    uncordon({pos}){const n=nodeArg(pos);if(!n.spec.unschedulable)return`node/${n.name} already uncordoned`;n.spec.unschedulable=false;event(n,'Normal','NodeSchedulable',`Node ${n.name} status is now: NodeSchedulable`);return`node/${n.name} uncordoned`},
    drain({flags,pos}){
      const n=nodeArg(pos);
      const pods=list('Pod').filter(p=>p.spec.nodeName===n.name);
      const bare=pods.filter(p=>!p.owner&&!p.spec.system);
      const ds=pods.filter(p=>p.spec.system&&/kube-proxy/.test(p.name));
      if(bare.length&&!flags.force){n.spec.unschedulable=true;fail(`node/${n.name} cordoned\nerror: unable to drain node "${n.name}" due to error: cannot delete cached/standalone Pods that declare no controller (use --force to override): ${bare.map(p=>p.namespace+'/'+p.name).join(', ')}, continuing command...\nThere are pending nodes to be drained:\n ${n.name}\ncannot delete cached/standalone Pods that declare no controller (use --force to override): ${bare.map(p=>p.namespace+'/'+p.name).join(', ')}`)}
      if(ds.length&&!flags['ignore-daemonsets']){n.spec.unschedulable=true;fail(`node/${n.name} cordoned\nerror: unable to drain node "${n.name}" due to error: cannot delete DaemonSet-managed Pods (use --ignore-daemonsets to ignore): ${ds.map(p=>p.namespace+'/'+p.name).join(', ')}, continuing command...\nThere are pending nodes to be drained:\n ${n.name}`)}
      if(n.name==='minikube'&&list('Node').length===1)var warn1=`cloudlab: este es el único nodo; los Pods desalojados quedarán en Pending hasta que hagas "kubectl uncordon ${n.name}" o añadas otro nodo con "minikube node add".`;
      n.spec.unschedulable=true;
      const out=[`node/${n.name} cordoned`];
      if(ds.length)out.push(`Warning: ignoring DaemonSet-managed Pods: ${ds.map(p=>p.namespace+'/'+p.name).join(', ')}`);
      const evict=pods.filter(p=>!p.spec.system);
      for(const p of evict)out.push(`evicting pod ${p.namespace}/${p.name}`);
      for(const p of evict){remove(p);out.push(`pod/${p.name} evicted`)}
      out.push(`node/${n.name} drained`);
      if(warn1)out.push(warn1);
      return out.join('\n');
    },
    'top node'({pos}){
      metrics();
      const nodes=pos[0]?[nodeArg(pos)]:list('Node');
      return table([['NAME','CPU(cores)','CPU(%)','MEMORY(bytes)','MEMORY(%)'],...nodes.map(n=>{const c=list('Pod').filter(p=>p.spec.nodeName===n.name).length;const cpu=60+c*7+(n.status.index?0:180);const mem=420+c*38+(n.status.index?0:480);return[n.name,`${cpu}m`,`${Math.round(cpu/20)}%`,`${mem}Mi`,`${Math.round(mem/39.12)}%`]})]);
    },
    'top pod'({flags,pos}){
      metrics();
      const ns=nsOf(flags),all=flags['all-namespaces'];
      const pods=list('Pod',all?null:ns).filter(p=>podView(p).status==='Running'&&(!pos[0]||p.name===pos[0]));
      if(pos[0]&&!pods.length)fail(`error: pods "${pos[0]}" not found`);
      if(!pods.length)return`No resources found in ${ns} namespace.`;
      return table([[...(all?['NAMESPACE']:[]),'NAME','CPU(cores)','MEMORY(bytes)'],...pods.map(p=>{const h=parseInt(hashStr(p.name,3),36)%40;const img=p.spec.containers[0].image;return[...(all?[p.namespace]:[]),p.name,`${/nginx|httpd/.test(img)?1+h%3:/redis/.test(img)?3+h%4:p.spec.system?5+h:1+h%5}m`,`${/nginx/.test(img)?3+h%6:/redis/.test(img)?4+h%5:/postgres|mysql|mongo/.test(img)?30+h:p.spec.system?20+h:2+h%8}Mi`]})]);
    },
    'cluster-info'(){return`Kubernetes control plane is running at ${server()}\nCoreDNS is running at ${server()}/api/v1/namespaces/kube-system/services/kube-dns:dns/proxy\n\nTo further debug and diagnose cluster problems, use 'kubectl cluster-info dump'.`},
    version({flags}){
      const cli={major:'1',minor:'37',gitVersion:VERSION,platform:'linux/amd64'};
      if(flags.output==='json')return JSON.stringify({clientVersion:cli,kustomizeVersion:'v5.7.1',...(flags.client?{}:{serverVersion:{...cli}})},null,2);
      if(flags.output==='yaml')return dumpYaml({clientVersion:cli,kustomizeVersion:'v5.7.1',...(flags.client?{}:{serverVersion:cli})});
      return`Client Version: ${VERSION}\nKustomize Version: v5.7.1${flags.client?'':`\nServer Version: ${serverVersion()}`}`;
    },
    'api-resources'({flags}){
      let rows=Object.entries(KINDS).map(([k,v])=>[v.plural,v.short.join(','),v.api,String(v.ns),k]);
      if(flags.namespaced)rows=rows.filter(r=>r[3]===flags.namespaced);
      if(flags.output==='name')return rows.map(r=>r[0]+(r[2].includes('/')?'.'+r[2].split('/')[0]:'')).join('\n');
      return table([['NAME','SHORTNAMES','APIVERSION','NAMESPACED','KIND'],...rows.sort((a,b)=>a[0].localeCompare(b[0]))])+'\n\ncloudlab: se listan solo los recursos simulados. Un clúster real tiene más de 50 (kubectl api-resources).';
    },
    explain({pos}){
      if(!pos.length)fail(`You must specify the type of resource to explain. Use "kubectl api-resources" for a complete list of supported resources.`);
      const parts=pos[0].toLowerCase().split('.');
      const kind=resolveKind(parts[0]);
      if(!kind)fail(`error: the server doesn't have a resource type "${parts[0]}"`);
      const key=[KINDS[kind].singular,...parts.slice(1)].join('.');
      const e=EXPLAIN[key];
      if(!e){if(parts.length>1)fail(`error: field "${parts.slice(1).join('.')}" does not exist`);return`KIND:       ${kind}\nVERSION:    ${KINDS[kind].api}\n\nDESCRIPTION:\n    ${kind} (documentación resumida no disponible en el simulador).`}
      return`GROUP:      ${e[1].includes('/')?e[1].split('/')[0]:''}\nKIND:       ${e[0]}\nVERSION:    ${e[1].split('/').pop()}\n\n${parts.length>1?`FIELD: ${parts[parts.length-1]} <${e[3]?'Object':'integer'}>\n\n`:''}DESCRIPTION:\n    ${e[2]}\n${e[3]?`\nFIELDS:\n${Object.entries(e[3]).map(([k,v])=>`  ${k}\t${v}`).join('\n')}`:''}`;
    },
    events({flags}){
      const ns=nsOf(flags);
      const ev=S.events.filter(e=>flags['all-namespaces']||e.namespace===ns).slice(-60);
      if(!ev.length)return`No events found in ${ns} namespace.`;
      return table([[...(flags['all-namespaces']?['NAMESPACE']:[]),'LAST SEEN','TYPE','REASON','OBJECT','MESSAGE'],...ev.map(e=>[...(flags['all-namespaces']?[e.namespace]:[]),age(now()-e.t),e.type,e.reason,`${KINDS[e.kind].singular}/${e.name}`,e.msg])]);
    },
    'port-forward'({flags,pos}){
      if(pos.length<2)fail(`error: TYPE/NAME and list of ports are required for port-forward\nSee 'kubectl port-forward -h' for help and examples`);
      const ns=nsOf(flags);
      const[t,n]=pos[0].includes('/')?pos[0].split('/'):['pod',pos[0]];
      const o=getOne(typeOrFail(t),n,ns);
      const[l,r]=pos[1].includes(':')?pos[1].split(':'):[pos[1],pos[1]];
      if(o.kind==='Service'&&!endpoints(o).length)fail(`error: unable to forward port because pod is not running. Current status=Pending`);
      return`Forwarding from 127.0.0.1:${l||r} -> ${r}\nForwarding from [::1]:${l||r} -> ${r}\ncloudlab: en un clúster real el comando se queda escuchando hasta Ctrl+C; aquí termina enseguida.`;
    },
    auth({pos}){
      if(pos[0]==='whoami')return table([['ATTRIBUTE','VALUE'],['Username','minikube-user'],['Groups','[system:masters system:authenticated]']]);
      if(pos[0]==='can-i')return pos.length<2?fail('error: you must specify two arguments: verb resource or a non-resource URL'):'yes';
      fail(`error: unknown command "${pos[0]||''}" for "kubectl auth"`);
    },
    wait({flags,pos}){
      if(!flags.for)fail('error: --for must be specified');
      const ns=nsOf(flags);
      const tg=targets(pos);
      const objs=tg.flatMap(t=>t.name?[getOne(t.kind,t.name,ns)]:list(t.kind,ns).filter(o=>selMatch(flags.selector,o.labels)));
      const out=objs.map(o=>{
        if(flags.for==='delete')return`${created(o,'condition met')}`;
        const ok=o.kind==='Pod'?podView(o).status==='Running':o.kind==='Deployment'?depStatus(o).ready===o.spec.replicas:true;
        return ok?created(o,'condition met'):`error: timed out waiting for the condition on ${KINDS[o.kind].plural}/${o.name}`;
      });
      return{out:out.join('\n'),code:out.some(x=>x.startsWith('error'))?1:0};
    },
  };
  function metrics(){if(!S.addons['metrics-server'])fail('error: Metrics API not available\ncloudlab: en minikube se activa con "minikube addons enable metrics-server".')}
  function nodeArg(pos){if(!pos[0])fail('error: USAGE: cordon NODE [flags]\nSee \'kubectl cordon -h\' for help and examples');const n=find('Node',pos[0].replace(/^nodes?\//,''));if(!n)fail(`Error from server (NotFound): nodes "${pos[0]}" not found`);return n}
  function depTarget(flags,pos){
    const tg=targets(pos,false);
    if(!tg.length||!tg[0].name)fail(`error: required resource not specified`);
    if(tg[0].kind!=='Deployment')fail(`error: no rollbacker has been implemented for "${tg[0].kind}" en este simulador (usa deployments)`);
    return getOne('Deployment',tg[0].name,nsOf(flags));
  }
  function createSvcCmd({flags,pos},type){
    needName(pos,`kubectl create service ${type.toLowerCase()} -h`);
    const name=pos[0],ns=nsOf(flags);checkName('Service',name);
    if(type==='ExternalName'&&!flags['external-name'])fail('error: external-name must be specified');
    let ports=parseTcp(flags.tcp);
    if(type!=='ExternalName'&&!ports.length)fail('error: at least one tcp port specifier must be provided');
    if(flags['node-port'])ports=ports.map(p=>({...p,nodePort:flags['node-port']}));
    const d=dryRunOut(flags,draft({kind:'Service',namespace:ns,name,labels:{app:name},spec:{type,selector:type==='ExternalName'?null:{app:name},ports,clusterIP:'',externalName:flags['external-name']}}));if(d!==null)return d;
    requireNs(ns);exists('Service',name,ns);
    if(flags['node-port']&&(flags['node-port']<30000||flags['node-port']>32767))fail(`The Service "${name}" is invalid: spec.ports[0].nodePort: Invalid value: ${flags['node-port']}: provided port is not in the valid range. The range of valid ports is 30000-32767`);
    return created(createService(ns,name,type,ports,type==='ExternalName'?null:{app:name},{externalName:flags['external-name']}));
  }
  function labelCmd(flags,pos,field,verb){
    const ns=nsOf(flags);
    const kv=pos.filter(p=>p.includes('=')||(/-$/.test(p)&&!p.includes('/')&&pos.indexOf(p)>0));
    const tgPos=pos.filter(p=>!kv.includes(p));
    const tg=targets(tgPos);
    if(!tg.length)fail(`error: one or more resources must be specified as <resource> <name> or <resource>/<name>`);
    if(!kv.length&&!flags.list)fail(`error: at least one ${field==='labels'?'label':'annotation'} update is required`);
    const objs=tg.flatMap(t=>t.name?[getOne(t.kind,t.name,ns)]:flags.all||flags.selector?list(t.kind,ns).filter(o=>selMatch(flags.selector,o.labels)):fail('error: resource(s) were provided, but no name was specified'));
    const out=[];
    for(const o of objs){
      if(flags.list){out.push(Object.entries(o[field]).map(([k,v])=>`${k}=${v}`).join('\n'));continue}
      let changed=false;
      for(const x of kv){
        if(x.endsWith('-')&&!x.includes('=')){const k=x.slice(0,-1);if(k in o[field]){delete o[field][k];changed=true}continue}
        const[k,v]=x.split(/=(.*)/s);
        if(field==='labels'&&!/^([a-z0-9.-]+\/)?[A-Za-z0-9]([-A-Za-z0-9_.]*[A-Za-z0-9])?$/.test(k))fail(`error: invalid label spec: ${x}`);
        if(k in o[field]&&o[field][k]!==v&&!flags.overwrite)fail(`error: '${k}' already has a value (${o[field][k]}), and --overwrite is false`);
        if(o[field][k]!==v){o[field][k]=v;changed=true}
      }
      if(field==='labels'&&o.kind==='Deployment'){}
      out.push(changed?created(o,verb):created(o,`not ${verb}`));
    }
    return out.join('\n');
  }

  // ---------- describe ----------
  function describeObj(o){
    const t=now();
    const ev=S.events.filter(e=>e.kind===o.kind&&e.name===o.name&&(e.namespace===(o.namespace||'default'))).slice(-12);
    const evs=ev.length?`Events:\n${table([['  Type','Reason','Age','From','Message'],['  ----','------','----','----','-------'],...ev.map(e=>[`  ${e.type}`,e.reason,age(t-e.t),e.reason==='Scheduled'||e.reason==='FailedScheduling'?'default-scheduler':o.kind==='Pod'?`kubelet`:o.kind==='Deployment'?'deployment-controller':o.kind==='ReplicaSet'?'replicaset-controller':o.kind==='Node'?'node-controller':'service-controller',e.msg])])}`:'Events:            <none>';
    const L=(m)=>{const e=Object.entries(m||{}).sort(([a],[b])=>a.localeCompare(b));return e.length?e.map(([k,v],i)=>`${i?' '.repeat(20):''}${k}=${v}`).join('\n'):'<none>'};
    const short=['ConfigMap','Secret','ReplicaSet'].includes(o.kind);
    const head=short?`Name:         ${o.name}\nNamespace:    ${o.namespace}\n`:`Name:               ${o.name}\n${o.namespace?`Namespace:          ${o.namespace}\n`:''}`;
    if(o.kind==='Pod'){
      const v=podView(o);const node=find('Node',o.spec.nodeName);
      return`${head}Priority:           0\nService Account:    default\nNode:               ${node?`${node.name}/${node.status.ip}`:'<none>'}\nStart Time:         ${o.status.scheduledAt?new Date(o.status.scheduledAt).toUTCString():'<unset>'}\nLabels:             ${L(o.labels)}\nAnnotations:        ${L(o.annotations)}\nStatus:             ${v.status==='Terminating'?'Terminating':v.phase}\nIP:                 ${o.status.podIP||''}\n${o.owner?`Controlled By:      ${o.owner.kind}/${o.owner.name}\n`:''}Containers:\n${o.spec.containers.map(c=>`  ${c.name}:\n    Image:          ${c.image}\n    Port:           ${c.ports?c.ports.map(p=>p.containerPort+'/TCP').join(', '):'<none>'}\n${c.command?`    Command:\n${c.command.map(x=>'      '+x).join('\n')}\n`:''}${c.args?`    Args:\n${c.args.map(x=>'      '+x).join('\n')}\n`:''}    State:          ${v.status==='Running'?`Running\n      Started:      ${new Date(o.status.scheduledAt+2500).toUTCString()}`:v.status==='Completed'?'Terminated\n      Reason:       Completed\n      Exit Code:    0':`Waiting\n      Reason:       ${v.status}`}\n    Ready:          ${v.ready===v.total&&v.status==='Running'?'True':'False'}\n    Restart Count:  ${v.restarts}\n    Environment:    ${c.env?c.env.map(e=>`\n      ${e.name}:  ${e.value}`).join(''):'<none>'}`).join('\n')}\nConditions:\n  Type                        Status\n  PodScheduled                ${o.spec.nodeName?'True':'False'}\n  Initialized                 True\n  ContainersReady             ${v.status==='Running'?'True':'False'}\n  Ready                       ${v.status==='Running'?'True':'False'}\nQoS Class:                   BestEffort\nNode-Selectors:              <none>\nTolerations:                 node.kubernetes.io/not-ready:NoExecute op=Exists for 300s\n                             node.kubernetes.io/unreachable:NoExecute op=Exists for 300s\n${evs}`;
    }
    if(o.kind==='Deployment'){
      const s=depStatus(o);
      const rss=list('ReplicaSet',o.namespace).filter(r=>r.owner&&r.owner.name===o.name);
      return`${head}CreationTimestamp:  ${new Date(o.created).toUTCString()}\nLabels:             ${L(o.labels)}\nAnnotations:        deployment.kubernetes.io/revision: ${o.status.revision||1}\nSelector:           ${labelStr(o.spec.selector)}\nReplicas:           ${o.spec.replicas} desired | ${s.updated} updated | ${s.current} total | ${s.ready} available | ${s.current-s.ready} unavailable\nStrategyType:       ${o.spec.strategy||'RollingUpdate'}\nMinReadySeconds:    0\nRollingUpdateStrategy:  25% max unavailable, 25% max surge\nPod Template:\n  Labels:  ${labelStr(o.spec.template.labels)}\n  Containers:\n${o.spec.template.containers.map(c=>`   ${c.name}:\n    Image:         ${c.image}\n    Port:          ${c.ports?c.ports[0].containerPort+'/TCP':'<none>'}\n    Environment:   ${c.env?c.env.map(e=>`${e.name}=${e.value}`).join(', '):'<none>'}`).join('\n')}\nConditions:\n  Type           Status  Reason\n  ----           ------  ------\n  Available      ${s.ready>=Math.max(1,Math.ceil(o.spec.replicas*.75))||o.spec.replicas===0?'True    MinimumReplicasAvailable':'False   MinimumReplicasUnavailable'}\n  Progressing    True    ${s.updated===o.spec.replicas?'NewReplicaSetAvailable':'ReplicaSetUpdated'}\nOldReplicaSets:  ${rss.filter(r=>r.name!==o.status.currentRS&&rsStatus(r).current).map(r=>`${r.name} (${rsStatus(r).current}/${r.spec.replicas} replicas created)`).join(', ')||'<none>'}\nNewReplicaSet:   ${o.status.currentRS} (${s.updated}/${o.spec.replicas} replicas created)\n${evs}`;
    }
    if(o.kind==='ReplicaSet'){const s=rsStatus(o);return`${head}Selector:     ${labelStr(o.spec.template.labels)}\nLabels:       ${L(o.labels)}\nAnnotations:  ${L(o.annotations)}\n${o.owner?`Controlled By:  Deployment/${o.owner.name}\n`:''}Replicas:     ${s.current} current / ${o.spec.replicas} desired\nPods Status:  ${s.ready} Running / ${s.current-s.ready} Waiting / 0 Succeeded / 0 Failed\nPod Template:\n  Labels:  ${labelStr(o.spec.template.labels)}\n  Containers:\n${o.spec.template.containers.map(c=>`   ${c.name}:\n    Image:  ${c.image}`).join('\n')}\n${evs}`}
    if(o.kind==='Service'){const ep=endpoints(o);return`${head}Labels:                   ${L(o.labels)}\nAnnotations:              <none>\nSelector:                 ${o.spec.selector?labelStr(o.spec.selector):'<none>'}\nType:                     ${o.spec.type}\nIP Family Policy:         SingleStack\nIP Families:              IPv4\n${o.spec.type==='ExternalName'?`External Name:            ${o.spec.externalName}`:`IP:                       ${o.spec.clusterIP}\nIPs:                      ${o.spec.clusterIP}`}\n${o.spec.ports.map(p=>`Port:                     ${p.name||'<unset>'}  ${p.port}/${p.protocol||'TCP'}\nTargetPort:               ${p.targetPort}/${p.protocol||'TCP'}${p.nodePort?`\nNodePort:                 ${p.name||'<unset>'}  ${p.nodePort}/TCP`:''}`).join('\n')}\nEndpoints:                ${ep.length?ep.slice(0,3).join(',')+(ep.length>3?` + ${ep.length-3} more...`:''):''}\nSession Affinity:         None\n${o.spec.type==='LoadBalancer'?'LoadBalancer Ingress:     <pending>\n':''}Internal Traffic Policy:  Cluster\n${evs}`}
    if(o.kind==='ConfigMap')return`${head}Labels:       ${L(o.labels)}\nAnnotations:  <none>\n\nData\n====\n${Object.entries(o.data||{}).map(([k,v])=>`${k}:\n----\n${v}\n`).join('\n')}\nBinaryData\n====\n\nEvents:  <none>`;
    if(o.kind==='Secret')return`${head}Labels:       ${L(o.labels)}\nAnnotations:  <none>\n\nType:  ${o.spec.type||'Opaque'}\n\nData\n====\n${Object.entries(o.data||{}).map(([k,v])=>`${k}:  ${String(v).length} bytes`).join('\n')}`;
    if(o.kind==='Namespace')return`Name:         ${o.name}\nLabels:       ${L(o.labels)}\nAnnotations:  <none>\nStatus:       Active\n\nNo resource quota.\n\nNo LimitRange resource.`;
    if(o.kind==='Node'){const pods=list('Pod').filter(p=>p.spec.nodeName===o.name);return`Name:               ${o.name}\nRoles:              ${'node-role.kubernetes.io/control-plane' in o.labels?'control-plane':'<none>'}\nLabels:             ${L(o.labels)}\nCreationTimestamp:  ${new Date(o.created).toUTCString()}\nTaints:             ${o.spec.unschedulable?'node.kubernetes.io/unschedulable:NoSchedule':'<none>'}\nUnschedulable:      ${o.spec.unschedulable?'true':'false'}\nConditions:\n  Type             Status  Reason                       Message\n  ----             ------  ------                       -------\n  MemoryPressure   False   KubeletHasSufficientMemory   kubelet has sufficient memory available\n  DiskPressure     False   KubeletHasNoDiskPressure     kubelet has no disk pressure\n  PIDPressure      False   KubeletHasSufficientPID      kubelet has sufficient PID available\n  Ready            ${o.status.ready?'True    KubeletReady                 kubelet is posting ready status':'False   KubeletNotReady              container runtime is down'}\nAddresses:\n  InternalIP:  ${o.status.ip}\n  Hostname:    ${o.name}\nCapacity:\n  cpu:     2\n  memory:  3912Mi\n  pods:    110\nSystem Info:\n  OS Image:                   Ubuntu 22.04.5 LTS\n  Container Runtime Version:  docker://28.4.0\n  Kubelet Version:            ${VERSION}\nPodCIDR:                      ${o.spec.podCIDR}\nNon-terminated Pods:          (${pods.length} in total)\n${table([['  Namespace','Name','Age'],['  ---------','----','---'],...pods.map(p=>[`  ${p.namespace}`,p.name,age(t-p.created)])])}\n${evs}`}
    return head;
  }

  // ---------- logs y exec simulados ----------
  function fakeLogs(p,c){
    const img=c.image,t0=p.status.scheduledAt||p.created,d=new Date(t0+2600);
    const stamp=d.toISOString().replace('T',' ').slice(0,19).replace(/-/g,'/');
    if(/nginx/.test(img))return[`/docker-entrypoint.sh: /docker-entrypoint.d/ is not empty, will attempt to perform configuration`,`/docker-entrypoint.sh: Looking for shell scripts in /docker-entrypoint.d/`,`/docker-entrypoint.sh: Launching /docker-entrypoint.d/10-listen-on-ipv6-by-default.sh`,`10-listen-on-ipv6-by-default.sh: info: Enabled listen on IPv6 in /etc/nginx/conf.d/default.conf`,`/docker-entrypoint.sh: Configuration complete; ready for start up`,`${stamp} [notice] 1#1: using the "epoll" event method`,`${stamp} [notice] 1#1: nginx/1.29.1`,`${stamp} [notice] 1#1: start worker processes`,...(p.status.hits||[]).map(h=>`10.244.0.1 - - [${d.toUTCString()}] "GET / HTTP/1.1" 200 615 "-" "${h}"`)];
    if(/redis/.test(img))return[`1:C ${d.toUTCString()} * oO0OoO0OoO0Oo Redis is starting oO0OoO0OoO0Oo`,`1:M ${d.toUTCString()} * Running mode=standalone, port=6379.`,`1:M ${d.toUTCString()} * Server initialized`,`1:M ${d.toUTCString()} * Ready to accept connections tcp`];
    if(/httpd|apache/.test(img))return[`AH00558: httpd: Could not reliably determine the server's fully qualified domain name, using ${p.status.podIP}.`,`[mpm_event:notice] [pid 1:tid 1] AH00489: Apache/2.4.65 (Unix) configured -- resuming normal operations`];
    if(/postgres/.test(img))return['Error: Database is uninitialized and superuser password is not specified.','       You must specify POSTGRES_PASSWORD to a non-empty value for the','       superuser.'];
    const cmd=[...(c.command||[]),...(c.args||[])].join(' ');
    const echo=cmd.match(/echo\s+["']?([^"';&|]+)/);
    if(echo)return[echo[1].trim()];
    if(/hello-world/.test(img))return['','Hello from Docker!','This message shows that your installation appears to be working correctly.'];
    if(/date/.test(cmd))return[new Date(now()).toUTCString()];
    return[];
  }
  function execIn(p,cmd,flags){
    const c=p.spec.containers[0];const bin=cmd[0];const rest=cmd.slice(1).join(' ');
    const env={PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',HOSTNAME:p.name,...Object.fromEntries((c.env||[]).map(e=>[e.name,e.value])),KUBERNETES_SERVICE_HOST:'10.96.0.1',KUBERNETES_SERVICE_PORT:'443',HOME:'/root'};
    for(const s of list('Service',p.namespace))if(s.spec.clusterIP){const N=s.name.toUpperCase().replace(/-/g,'_');env[`${N}_SERVICE_HOST`]=s.spec.clusterIP;env[`${N}_SERVICE_PORT`]=String(s.spec.ports[0]?.port)}
    if((bin==='sh'||bin==='bash'||bin==='/bin/sh'||bin==='/bin/bash')&&cmd[1]==='-c')return execIn(p,tokenize(cmd.slice(2).join(' ')).filter(x=>typeof x==='string'),flags);
    if(bin==='sh'||bin==='bash'||bin==='/bin/sh'||bin==='/bin/bash'){if(bin.endsWith('bash')&&/busybox|alpine/.test(c.image))fail(`error: Internal error occurred: Internal error occurred: error executing command in container: failed to exec in container: failed to start exec "${rand(12)}": OCI runtime exec failed: exec failed: unable to start container process: exec: "bash": executable file not found in $PATH: unknown\ncommand terminated with exit code 126`);return`cloudlab: las shells interactivas no se simulan. Ejecuta cada comando con:\n  kubectl exec ${p.name} -- <comando>\nPor ejemplo: kubectl exec ${p.name} -- env   |   kubectl exec ${p.name} -- ls /`}
    if(bin==='env'||bin==='printenv')return Object.entries(env).map(([k,v])=>`${k}=${v}`).join('\n');
    if(bin==='hostname')return p.name;
    if(bin==='whoami')return'root';
    if(bin==='date')return new Date(now()).toUTCString();
    if(bin==='pwd')return'/';
    if(bin==='ls'){const dir=cmd.filter(x=>!x.startsWith('-'))[1]||'/';if(/nginx\/html/.test(dir))return'50x.html\nindex.html';if(dir==='/'||dir==='.')return'bin\nboot\ndev\netc\nhome\nlib\nmedia\nmnt\nopt\nproc\nroot\nrun\nsbin\nsrv\nsys\ntmp\nusr\nvar';if(/\/etc\/config|\/config/.test(dir)){return'cloudlab: monta un ConfigMap como volumen con un manifiesto (kubectl apply) para ver sus ficheros aquí.'}return`ls: ${dir}: No such file or directory`}
    if(bin==='cat'){const f=cmd[1]||'';if(f==='/etc/hostname')return p.name;if(f==='/etc/os-release')return/alpine|busybox/.test(c.image)?'NAME="Alpine Linux"\nID=alpine\nVERSION_ID=3.22.1':'PRETTY_NAME="Debian GNU/Linux 12 (bookworm)"\nNAME="Debian GNU/Linux"\nVERSION_ID="12"';if(f==='/etc/resolv.conf')return`search ${p.namespace}.svc.cluster.local svc.cluster.local cluster.local\nnameserver 10.96.0.10\noptions ndots:5`;if(/index\.html/.test(f)&&/nginx/.test(c.image))return nginxPage();return`cat: can't open '${f}': No such file or directory`}
    if(bin==='curl'||bin==='wget'){
      const url=cmd.slice(1).filter(x=>!x.startsWith('-'))[0];
      if(!url)return bin==='curl'?'curl: try \'curl --help\' for more information':'BusyBox v1.37.0 multi-call binary.\n\nUsage: wget [-cqS] [-O FILE] URL';
      if(bin==='curl'&&/busybox/.test(c.image))fail(`error: Internal error occurred: exec: "curl": executable file not found in $PATH\ncommand terminated with exit code 126\ncloudlab: busybox no trae curl; usa wget -qO- <url>.`);
      return httpGet(url.replace(/^https?:\/\//,''),p.namespace,bin);
    }
    if(bin==='nslookup'){const h=cmd[1]||'';const r=resolveSvc(h,p.namespace);if(!r)return`Server:\t\t10.96.0.10\nAddress:\t10.96.0.10:53\n\n** server can't find ${h}.${p.namespace}.svc.cluster.local: NXDOMAIN\ncommand terminated with exit code 1`;return`Server:\t\t10.96.0.10\nAddress:\t10.96.0.10:53\n\nName:\t${r.svc.name}.${r.svc.namespace}.svc.cluster.local\nAddress: ${r.svc.spec.clusterIP}`}
    if(bin==='echo')return cmd.slice(1).join(' ').replace(/\$(\w+)/g,(_,k)=>env[k]??'');
    if(bin==='ps')return'PID   USER     TIME  COMMAND\n    1 root      0:00 '+(/nginx/.test(c.image)?'nginx: master process nginx -g daemon off;':[...(c.command||[]),...(c.args||[])].join(' ')||c.image.split(':')[0]);
    if(bin==='nginx'&&cmd[1]==='-v')return'nginx version: nginx/1.29.1';
    fail(`error: Internal error occurred: Internal error occurred: error executing command in container: failed to exec in container: OCI runtime exec failed: exec failed: unable to start container process: exec: "${bin}": executable file not found in $PATH: unknown\ncommand terminated with exit code 126`);
  }
  function resolveSvc(host,ns){
    const h=host.split(':')[0].split('/')[0];
    const parts=h.split('.');
    const svcNs=parts[1]&&parts[1]!=='svc'?parts[1]:ns;
    const svc=find('Service',parts[0],svcNs);
    if(svc)return{svc,port:+(host.split(':')[1]||'').split('/')[0]||svc.spec.ports[0]?.port};
    const pod=list('Pod').find(p=>p.status.podIP===h);
    if(pod)return{pod};
    const byIp=list('Service').find(s=>s.spec.clusterIP===h);
    return byIp?{svc:byIp,port:+(host.split(':')[1]||'')||byIp.spec.ports[0]?.port}:null;
  }
  function httpGet(url,ns,bin){
    const r=resolveSvc(url,ns);
    if(!r)return{out:bin==='curl'?`curl: (6) Could not resolve host: ${url.split('/')[0]}`:`wget: bad address '${url.split('/')[0]}'`,code:1,err:true};
    let pods;
    if(r.pod)pods=[r.pod];
    else{if(r.svc.spec.type==='ExternalName')return`cloudlab: ${r.svc.name} es un alias DNS (CNAME) de ${r.svc.spec.externalName}; el simulador no sale a Internet.`;if(r.port&&!r.svc.spec.ports.some(p=>p.port===r.port))return{out:bin==='curl'?`curl: (28) Failed to connect to ${url.split('/')[0]} port ${r.port} after 3000 ms: Timeout was reached`:'wget: download timed out',code:1,err:true};pods=list('Pod',r.svc.namespace).filter(p=>r.svc.spec.selector&&selMatch(labelStr(r.svc.spec.selector),p.labels)&&podView(p).status==='Running')}
    if(!pods.length)return{out:bin==='curl'?`curl: (7) Failed to connect to ${url.split('/')[0]} port ${r.port||80} after 2 ms: Couldn't connect to server`:`wget: can't connect to remote host (${r.svc.spec.clusterIP}): Connection refused`,code:1,err:true};
    const target=pods[Math.floor(Math.random()*pods.length)];
    const img=target.spec.containers[0].image;
    target.status.hits=(target.status.hits||[]).concat(bin==='curl'?'curl/8.15.0':'Wget').slice(-20);
    if(/nginx/.test(img))return nginxPage();
    if(/httpd/.test(img))return'<html><body><h1>It works!</h1></body></html>';
    if(/echo|http-echo|httpbin/.test(img))return`Hostname: ${target.name}\nPod IP: ${target.status.podIP}\nRequest: GET /`;
    if(/hello-app|hello-kubernetes|aks-helloworld|nginxdemos|podinfo/.test(img))return`Hello, world!\nVersion: 1.0.0\nHostname: ${target.name}`;
    return{out:bin==='curl'?`curl: (7) Failed to connect to ${url.split('/')[0]} port ${r.port||80}: Connection refused`:'wget: can\'t connect to remote host: Connection refused',code:1,err:true};
  }
  const nginxPage=()=>`<!DOCTYPE html>\n<html>\n<head>\n<title>Welcome to nginx!</title>\n</head>\n<body>\n<h1>Welcome to nginx!</h1>\n<p>If you see this page, the nginx web server is successfully installed and\nworking. Further configuration is required.</p>\n</body>\n</html>`;

  // ---------- Manifiestos (apply / create -f) ----------
  function readDocs(file,stdin){
    let text;
    if(file==='-'){if(stdin==null||stdin==='')fail('error: no objects passed to apply');text=stdin}
    else{if(!(file in S.files))fail(`error: the path "${file}" does not exist`);text=S.files[file]}
    let docs;
    try{docs=yaml.loadAll(text).filter(Boolean)}catch(e){const m=String(e.message||e).split('\n')[0];fail(`error: error parsing ${file==='-'?'STDIN':file}: error converting YAML to JSON: yaml: ${m}`)}
    const out=[];
    for(const d of docs){if(d&&d.kind==='List'&&Array.isArray(d.items))out.push(...d.items);else out.push(d)}
    if(!out.length)fail('error: no objects passed to apply');
    return out.map(d=>{d.__file=file==='-'?'STDIN':file;return d});
  }
  function applyFiles(files,flags,stdin,createOnly){
    const out=[];let err=false;
    for(const f of files){
      for(const m of readDocs(f,stdin)){
        try{out.push(applyOne(m,flags,createOnly))}catch(e){if(!(e instanceof CmdError))throw e;out.push(e.message);err=true}
      }
    }
    return{out:out.join('\n'),code:err?1:0,err};
  }
  function applyOne(m,flags,createOnly){
    const file=m.__file;
    if(typeof m!=='object'||Array.isArray(m))fail(`error: error validating "${file}": error validating data: invalid object to validate`);
    const missing=['apiVersion','kind'].filter(k=>!m[k]);
    if(missing.length)fail(`error: error validating "${file}": error validating data: [${missing.map(k=>`${k} not set`).join(', ')}]; if you choose to ignore these errors, turn validation off with --validate=false`);
    const kind=Object.keys(KINDS).find(k=>k===m.kind);
    if(!kind){
      if(/^(StatefulSet|DaemonSet|Job|CronJob|Ingress|PersistentVolumeClaim|PersistentVolume|StorageClass|ServiceAccount|Role|RoleBinding|ClusterRole|ClusterRoleBinding|NetworkPolicy|HorizontalPodAutoscaler|ResourceQuota|LimitRange)$/.test(m.kind))fail(`cloudlab: el kind "${m.kind}" es válido en Kubernetes, pero todavía no se simula. Recursos simulados: Pod, Deployment, ReplicaSet, Service, ConfigMap, Secret, Namespace.`);
      fail(`error: resource mapping not found for name: "${m.metadata&&m.metadata.name||''}" namespace: "${m.metadata&&m.metadata.namespace||''}" from "${file}": no matches for kind "${m.kind}" in version "${m.apiVersion}"\nensure CRDs are installed first`);
    }
    if(KINDS[kind].api!==m.apiVersion)fail(`error: resource mapping not found for name: "${m.metadata&&m.metadata.name||''}" namespace: "" from "${file}": no matches for kind "${kind}" in version "${m.apiVersion}"\nensure CRDs are installed first`);
    if(kind==='Node'||kind==='Event'||kind==='ReplicaSet'&&false)fail(`cloudlab: crear ${kind} con un manifiesto no se simula.`);
    const md=m.metadata||{};
    const name=md.name;
    if(!name)fail(`error: error when retrieving current configuration of:\nResource: "${KINDS[kind].plural}", GroupVersionKind: "${KINDS[kind].api}, Kind=${kind}"\nName: "", Namespace: "${md.namespace||nsOf(flags)}"\nfrom server for: "${file}": resource name may not be empty`);
    checkName(kind,name);
    const ns=KINDS[kind].ns?(md.namespace||nsOf(flags)):undefined;
    if(flags.namespace&&md.namespace&&flags.namespace!==md.namespace)fail(`error: the namespace from the provided object "${md.namespace}" does not match the namespace "${flags.namespace}". You must pass '--namespace=${md.namespace}' to perform this operation.`);
    if(ns)requireNs(ns);
    const spec=m.spec||{};
    const labels=md.labels||{};
    let obj;
    const validateContainers=(cs,path)=>{
      if(!Array.isArray(cs)||!cs.length)fail(`The ${kind} "${name}" is invalid: ${path}: Required value`);
      cs.forEach((c,i)=>{for(const k of Object.keys(c))if(!['name','image','command','args','ports','env','envFrom','resources','imagePullPolicy','volumeMounts','livenessProbe','readinessProbe','startupProbe','workingDir','securityContext','lifecycle'].includes(k))fail(`Error from server (BadRequest): error when creating "${file}": ${kind} in version "${KINDS[kind].api.split('/').pop()}" cannot be handled as a ${kind}: strict decoding error: unknown field "${path.replace(/\.containers$/,'')}.containers[${i}].${k}"`);if(!c.name)fail(`The ${kind} "${name}" is invalid: ${path}[${i}].name: Required value`);if(!c.image)fail(`The ${kind} "${name}" is invalid: ${path}[${i}].image: Required value`)});
      return cs.map(c=>({name:c.name,image:String(c.image),...(c.command?{command:c.command.map(String)}:{}),...(c.args?{args:c.args.map(String)}:{}),...(c.ports?{ports:c.ports}:{}),...(c.env?{env:c.env.map(e=>({name:e.name,value:String(e.value??'')}))}:{}),...(c.resources?{resources:c.resources}:{})}));
    };
    for(const k of Object.keys(m))if(!['apiVersion','kind','metadata','spec','data','stringData','type','status','__file','immutable','binaryData'].includes(k))fail(`Error from server (BadRequest): error when creating "${file}": ${kind} in version "${m.apiVersion.split('/').pop()}" cannot be handled as a ${kind}: strict decoding error: unknown field "${k}"`);
    if(kind==='Pod')obj={kind,namespace:ns,name,labels,spec:{containers:validateContainers(spec.containers,'spec.containers'),restartPolicy:spec.restartPolicy||'Always'}};
    else if(kind==='Deployment'){
      const sel=spec.selector&&spec.selector.matchLabels;
      if(!sel)fail(`The Deployment "${name}" is invalid: \n* spec.selector: Required value\n* spec.template.metadata.labels: Invalid value: map[string]string(nil): \`selector\` does not match template \`labels\``);
      const tl=(spec.template&&spec.template.metadata&&spec.template.metadata.labels)||{};
      if(!Object.entries(sel).every(([k,v])=>tl[k]===v))fail(`The Deployment "${name}" is invalid: spec.template.metadata.labels: Invalid value: map[string]string{${Object.entries(tl).map(([k,v])=>`"${k}":"${v}"`).join(', ')}}: \`selector\` does not match template \`labels\``);
      const cs=validateContainers(spec.template&&spec.template.spec&&spec.template.spec.containers,'spec.template.spec.containers');
      const strategy=spec.strategy&&spec.strategy.type;
      if(strategy&&!['RollingUpdate','Recreate'].includes(strategy))fail(`The Deployment "${name}" is invalid: spec.strategy.type: Unsupported value: "${strategy}": supported values: "Recreate", "RollingUpdate"`);
      obj={kind,namespace:ns,name,labels,annotations:md.annotations||{},spec:{replicas:spec.replicas??1,selector:sel,strategy,template:{labels:tl,...(spec.template.metadata.annotations?{annotations:spec.template.metadata.annotations}:{}),containers:cs}}};
    }else if(kind==='ReplicaSet')fail('cloudlab: crea un Deployment en lugar de un ReplicaSet directamente (es lo recomendado y lo que simula Cloud Lab).');
    else if(kind==='Service'){
      const type=spec.type||'ClusterIP';
      if(!['ClusterIP','NodePort','LoadBalancer','ExternalName'].includes(type))fail(`The Service "${name}" is invalid: spec.type: Unsupported value: "${type}": supported values: "ClusterIP", "ExternalName", "LoadBalancer", "NodePort"`);
      if(type!=='ExternalName'&&(!Array.isArray(spec.ports)||!spec.ports.length))fail(`The Service "${name}" is invalid: spec.ports: Required value`);
      (spec.ports||[]).forEach((p,i)=>{if(p.port==null)fail(`The Service "${name}" is invalid: spec.ports[${i}].port: Required value`);if(p.nodePort&&(p.nodePort<30000||p.nodePort>32767))fail(`The Service "${name}" is invalid: spec.ports[${i}].nodePort: Invalid value: ${p.nodePort}: provided port is not in the valid range. The range of valid ports is 30000-32767`)});
      obj={kind,namespace:ns,name,labels,spec:{type,selector:spec.selector||null,ports:(spec.ports||[]).map(p=>({...(p.name?{name:p.name}:{}),port:p.port,targetPort:p.targetPort??p.port,protocol:p.protocol||'TCP',...(p.nodePort?{nodePort:p.nodePort}:{})})),externalName:spec.externalName}};
    }else if(kind==='ConfigMap')obj={kind,namespace:ns,name,labels,data:Object.fromEntries(Object.entries(m.data||{}).map(([k,v])=>[k,String(v)]))};
    else if(kind==='Secret'){
      const data={};
      for(const[k,v]of Object.entries(m.data||{})){const d=unb64(String(v));if(d===null)fail(`Error from server (BadRequest): error when creating "${file}": Secret in version "v1" cannot be handled as a Secret: illegal base64 data at input byte 0`);data[k]=d}
      Object.assign(data,Object.fromEntries(Object.entries(m.stringData||{}).map(([k,v])=>[k,String(v)])));
      obj={kind,namespace:ns,name,labels,data,spec:{type:m.type||'Opaque'}};
    }else if(kind==='Namespace')obj={kind,name,labels:{'kubernetes.io/metadata.name':name,...labels}};
    const dr=dryRunOut(flags,draft(obj));if(dr!==null)return dr;
    const cur=find(kind,name,ns);
    if(cur){
      if(createOnly)fail(`Error from server (AlreadyExists): error when creating "${file}": ${KINDS[kind].plural}${KINDS[kind].api.includes('/')?'.'+KINDS[kind].api.split('/')[0]:''} "${name}" already exists`);
      const before=JSON.stringify([cur.labels,cur.spec,cur.data]);
      if(kind==='Pod'){
        const a=JSON.stringify(cur.spec.containers.map(c=>c.image)),b=JSON.stringify(obj.spec.containers.map(c=>c.image));
        if(JSON.stringify(cur.spec.containers.map(({image,...r})=>r))!==JSON.stringify(obj.spec.containers.map(({image,...r})=>r)))fail(`The Pod "${name}" is invalid: spec: Forbidden: pod updates may not change fields other than \`spec.containers[*].image\`,\`spec.initContainers[*].image\`,\`spec.activeDeadlineSeconds\`,\`spec.tolerations\` (only additions to existing tolerations),\`spec.terminationGracePeriodSeconds\` (allow it to be set to 1 if it was previously negative)`);
        if(a!==b){cur.spec.containers=obj.spec.containers;cur.status.scheduledAt=now()}
        cur.labels=obj.labels;
      }else if(kind==='Deployment'){
        if(JSON.stringify(cur.spec.selector)!==JSON.stringify(obj.spec.selector))fail(`The Deployment "${name}" is invalid: spec.selector: Invalid value: v1.LabelSelector{MatchLabels:map[string]string{${Object.entries(obj.spec.selector).map(([k,v])=>`"${k}":"${v}"`).join(', ')}}}: field is immutable`);
        cur.labels=obj.labels;cur.spec.replicas=obj.spec.replicas;cur.spec.strategy=obj.spec.strategy;cur.spec.template=obj.spec.template;
        if(obj.annotations['kubernetes.io/change-cause'])cur.annotations['kubernetes.io/change-cause']=obj.annotations['kubernetes.io/change-cause'];
      }else if(kind==='Service'){
        if(cur.spec.type!==obj.spec.type&&obj.spec.type==='ClusterIP')cur.spec.ports.forEach(p=>delete p.nodePort);
        const keep=cur.spec.clusterIP;cur.labels=obj.labels;cur.spec={...obj.spec,clusterIP:keep,ports:obj.spec.ports.map((p,i)=>({...p,...((obj.spec.type==='NodePort'||obj.spec.type==='LoadBalancer')?{nodePort:p.nodePort||cur.spec.ports[i]?.nodePort||nodePort()}:{})}))};
      }else{cur.labels=obj.labels;if(obj.data)cur.data=obj.data;if(obj.spec&&kind==='Secret')cur.spec=obj.spec}
      cur.rv=++S.seq;
      return created(cur,before===JSON.stringify([cur.labels,cur.spec,cur.data])?'unchanged':'configured');
    }
    S.stats=S.stats||{};S.stats.applied=(S.stats.applied||0)+1;
    let o;
    if(kind==='Deployment')o=createDeployment(ns,name,obj.spec.template.containers,obj.spec.replicas,obj.labels,{selector:obj.spec.selector,tplLabels:obj.spec.template.labels,strategy:obj.spec.strategy,annotations:obj.annotations});
    else if(kind==='Pod')o=makePod(ns,name,{labels:obj.labels,containers:obj.spec.containers,restartPolicy:obj.spec.restartPolicy});
    else if(kind==='Service')o=createService(ns,name,obj.spec.type,obj.spec.ports,obj.spec.selector,{labels:obj.labels,externalName:obj.spec.externalName});
    else if(kind==='Namespace'){o=put(obj);put({kind:'ConfigMap',namespace:name,name:'kube-root-ca.crt',data:{'ca.crt':'-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----'}})}
    else o=put(obj);
    return created(o);
  }
  function deleteObj(o){
    if(o.kind==='Namespace'){for(const x of S.items.filter(x=>x.namespace===o.name))remove(x);S.events=S.events.filter(e=>e.namespace!==o.name)}
    if(o.kind==='Deployment'){for(const rs of list('ReplicaSet',o.namespace).filter(r=>r.owner&&r.owner.name===o.name)){for(const p of list('Pod',o.namespace).filter(p=>p.owner&&p.owner.name===rs.name))remove(p);remove(rs)}}
    if(o.kind==='ReplicaSet'){for(const p of list('Pod',o.namespace).filter(p=>p.owner&&p.owner.name===o.name))remove(p)}
    if(o.kind==='Node'){for(const p of list('Pod').filter(p=>p.spec.nodeName===o.name)){if(p.owner)remove(p);else{p.spec.nodeName=null;p.status={}}}}
    if(o.kind==='Pod'&&o.owner)event(o,'Normal','Killing',`Stopping container ${o.spec.containers[0].name}`);
    remove(o);
  }

  // ---------- minikube ----------
  function minikube(args){
    const sub=args[0];
    const nodeNames=()=>list('Node').map(n=>n.name);
    switch(sub){
      case undefined:case'--help':case'help':return`minikube provisions and manages local Kubernetes clusters optimized for development workflows.\n\nBasic Commands:\n  start          Starts a local Kubernetes cluster\n  status         Gets the status of a local Kubernetes cluster\n  stop           Stops a running local Kubernetes cluster\n  delete         Deletes a local Kubernetes cluster\n  dashboard      Access the Kubernetes dashboard running within the minikube cluster\n\nImages / Networking:\n  service        Returns a URL to connect to a service\n  tunnel         Connect to LoadBalancer services\n  ip             Retrieves the IP address of the specified node\n\nConfiguration and Management Commands:\n  addons         Enable or disable a minikube addon\n  node           Add, remove, or list additional nodes\n\nOther Commands:\n  version        Print the version of minikube\n\nUse "minikube <command> --help" for more information about a given command.`;
      case'version':return`minikube version: ${MINIKUBE_VERSION}\ncommit: 65318f4cfff9c12cc87ec9eb8f4cdd57b25047f3`;
      case'status':return S.running?nodeNames().map((n,i)=>`${n}\ntype: ${i?'Worker':'Control Plane'}\nhost: Running\nkubelet: Running${i?'':'\napiserver: Running\nkubeconfig: Configured'}`).join('\n\n'):{out:'minikube\ntype: Control Plane\nhost: Stopped\nkubelet: Stopped\napiserver: Stopped\nkubeconfig: Stopped',code:7};
      case'start':if(S.running)return`😄  minikube ${MINIKUBE_VERSION} on Linux\n✨  Using the docker driver based on existing profile\n👍  Starting "minikube" primary control-plane node in "minikube" cluster\n🏃  Updating the running docker "minikube" container ...\n🐳  Preparing Kubernetes ${VERSION} on Docker 28.4.0 ...\n🔎  Verifying Kubernetes components...\n🌟  Enabled addons: storage-provisioner, default-storageclass\n🏄  Done! kubectl is now configured to use "minikube" cluster and "default" namespace by default`;
        S.running=true;return`😄  minikube ${MINIKUBE_VERSION} on Linux\n✨  Using the docker driver based on existing profile\n👍  Starting "minikube" primary control-plane node in "minikube" cluster\n🔄  Restarting existing docker container for "minikube" ...\n🐳  Preparing Kubernetes ${VERSION} on Docker 28.4.0 ...\n🔎  Verifying Kubernetes components...\n🏄  Done! kubectl is now configured to use "minikube" cluster and "default" namespace by default`;
      case'stop':if(!S.running)return'✋  Stopping node "minikube"  ...\n🛑  1 node stopped.';S.running=false;return`✋  Stopping node "minikube"  ...\n🛑  Powering off "minikube" via SSH ...\n🛑  ${nodeNames().length} node${nodeNames().length>1?'s':''} stopped.`;
      case'delete':return'cloudlab: para borrar todo el clúster simulado y empezar de cero usa: lab reset';
      case'ip':return`192.168.49.${2+((find('Node',(args.find(a=>a.startsWith('--node='))||'').slice(7))||{status:{index:0}}).status.index)}`;
      case'dashboard':return'🤔  Verifying dashboard health ...\n🚀  Launching proxy ...\ncloudlab: el dashboard web no se simula. Usa el mapa del clúster que tienes al lado de la terminal 😉';
      case'tunnel':{const lbs=list('Service').filter(s=>s.spec.type==='LoadBalancer');lbs.forEach(s=>s.status.externalIP='127.0.0.1');return`✅  Tunnel successfully started\n\n📌  NOTE: Please do not close this terminal as this process must stay alive for the tunnel to be accessible ...\n\n${lbs.map(s=>`🏃  Starting tunnel for service ${s.name}.`).join('\n')||'(no hay Services LoadBalancer)'}\ncloudlab: los Services LoadBalancer ya tienen EXTERNAL-IP 127.0.0.1.`}
      case'service':{
        const name=args.slice(1).find(a=>!a.startsWith('-'));
        if(!name)fail('❌  Exiting due to MK_USAGE: You must specify a service name');
        if(name==='list')return table([['NAMESPACE','NAME','TARGET PORT','URL'],...list('Service').map(s=>[s.namespace,s.name,s.spec.ports.map(p=>p.targetPort).join(' ')||'No node port',s.spec.ports.some(p=>p.nodePort)?s.spec.ports.filter(p=>p.nodePort).map(p=>`http://192.168.49.2:${p.nodePort}`).join(' '):''])]);
        const nsA=args.find(a=>a.startsWith('--namespace=')||a.startsWith('-n='));const ns=nsA?nsA.split('=')[1]:(args.includes('-n')?args[args.indexOf('-n')+1]:curNs());
        const s=find('Service',name,ns);
        if(!s)fail(`❌  Exiting due to SVC_NOT_FOUND: Service '${name}' was not found in '${ns}' namespace.\nYou may select another namespace by using 'minikube service ${name} -n <namespace>'. Or list out all the services using 'minikube service list'`);
        const np=s.spec.ports.find(p=>p.nodePort);
        if(!np)fail(`😿  service ${ns}/${name} has no node port\n❗  Services [${ns}/${name}] have type "ClusterIP" not meant to be exposed, however for local development minikube allows you to access this !`);
        return`http://192.168.49.2:${np.nodePort}`;
      }
      case'addons':{
        const a=args[1],name=args[2];
        if(a==='list')return table([['ADDON NAME','PROFILE','STATUS'],...Object.entries(S.addons).map(([k,v])=>[k,'minikube',v?'enabled ✅':'disabled'])]);
        if(a==='enable'||a==='disable'){if(!(name in S.addons))fail(`❌  Exiting due to MK_ADDON_ENABLE: enable failed: addon '${name}' no existe en el simulador (disponibles: ${Object.keys(S.addons).join(', ')})`);S.addons[name]=a==='enable';return a==='enable'?`💡  ${name} is an addon maintained by Kubernetes.\n    ▪ Using image registry.k8s.io/metrics-server/metrics-server:v0.8.0\n🌟  The '${name}' addon is enabled`:`🌑  "The '${name}' addon is disabled"`}
        fail('❌  Exiting due to MK_USAGE: usa minikube addons list|enable|disable <addon>');
      }
      case'node':{
        const a=args[1];
        if(a==='list')return list('Node').map(n=>`${n.name}\t${n.status.ip}`).join('\n');
        if(a==='add'){
          let i=2;while(find('Node',`minikube-m${String(i).padStart(2,'0')}`))i++;
          const name=`minikube-m${String(i).padStart(2,'0')}`;
          addNode(name,false);
          const kp=put({kind:'Pod',namespace:'kube-system',name:'kube-proxy-'+rand(5),labels:{'k8s-app':'kube-proxy'},spec:{containers:[{name:'kube-proxy',image:'registry.k8s.io/kube-proxy:'+VERSION}],restartPolicy:'Always',nodeName:name,system:true},status:{scheduledAt:now(),podIP:find('Node',name).status.ip}});
          event(find('Node',name),'Normal','RegisteredNode',`Node ${name} event: Registered Node ${name} in Controller`);
          reconcile();
          return`😄  Adding node m${String(i).padStart(2,'0')} to cluster minikube as [worker]\n👍  Starting "${name}" worker node in "minikube" cluster\n🚜  Pulling base image v0.0.48 ...\n🔥  Creating docker container (CPUs=2, Memory=2200MB) ...\n🐳  Preparing Kubernetes ${VERSION} on Docker 28.4.0 ...\n🔎  Verifying Kubernetes components...\n🏄  Successfully added m${String(i).padStart(2,'0')} to minikube!`;
        }
        if(a==='delete'){
          const name=args[2];
          if(!name)fail('❌  Exiting due to MK_USAGE: Usage: minikube node delete [name]');
          const n=find('Node',name)||find('Node',`minikube-${name}`);
          if(!n)fail(`🤷  Node ${name} does not exist.`);
          if(n.name==='minikube')fail('❌  Exiting due to GUEST_NODE_DELETE: cannot delete the control-plane node');
          deleteObj(n);reconcile();
          return`🔥  Deleting node ${n.name} from cluster minikube\n✋  Stopping node "${n.name}"  ...\n🔥  Deleting "${n.name}" in docker ...\n💀  Node ${n.name} was successfully deleted.`;
        }
        fail('❌  Exiting due to MK_USAGE: usa minikube node add|list|delete');
      }
      case'kubectl':return run('kubectl '+args.slice(1).map(q).join(' ').replace(/^--\s*/,''));
    }
    const s=suggest(sub,['start','status','stop','delete','ip','dashboard','tunnel','service','addons','node','version']);
    fail(`Error: unknown command "${sub}" for "minikube"${s.length?`\n\nDid you mean this?\n${s.map(x=>'\t'+x).join('\n')}`:''}\nRun 'minikube --help' for usage.`);
  }
  const q=s=>/[\s"'$|&;<>]/.test(s)?`'${s.replace(/'/g,"'\\''")}'`:s;

  // ---------- Mini shell ----------
  function builtin(args,stdin){
    const [cmd,...rest]=args;
    switch(cmd){
      case'kubectl':case'k':return kubectl(rest,stdin);
      case'minikube':{
        const prev=S.cluster;useCluster('minikube');
        try{return minikube(rest)}finally{if(prev!=='minikube'&&S.parked[prev])useCluster(prev)}
      }
      case'help':return shellHelp();
      case'ls':{const f=Object.keys(S.files).sort();return rest.includes('-l')||rest.includes('-la')?f.map(n=>`-rw-r--r-- 1 user user ${pad(S.files[n].length,5)} ${n}`).join('\n'):f.join('  ')}
      case'cat':{if(!rest.length)return stdin??'';return rest.map(f=>f in S.files?S.files[f].replace(/\n$/,''):fail(`cat: ${f}: No such file or directory`)).join('\n')}
      case'rm':{if(!rest.length)fail('rm: missing operand');for(const f of rest.filter(x=>!x.startsWith('-'))){if(!(f in S.files))fail(`rm: cannot remove '${f}': No such file or directory`);delete S.files[f]}return''}
      case'touch':{for(const f of rest)S.files[f]=S.files[f]||'';return''}
      case'echo':return rest.join(' ');
      case'pwd':return'/home/user';
      case'whoami':return'user';
      case'date':return new Date(now()).toString();
      case'clear':return{out:'',clear:true};
      case'history':return S.history.map((h,i)=>`${pad(i+1,5)} ${h}`).join('\n');
      case'nano':case'vi':case'vim':return`cloudlab: los editores no están disponibles. Crea o reemplaza un fichero así:\n  cat <<EOF > ${rest[0]||'deploy.yaml'}\n  apiVersion: v1\n  ...\n  EOF`;
      case'grep':{
        const flags=rest.filter(x=>/^-[a-zA-Z]+$/.test(x)).join('');
        const pat=rest.find(x=>!/^-[a-zA-Z]+$/.test(x));
        if(pat==null)fail('Usage: grep [OPTION]... PATTERNS [FILE]...');
        let re;try{re=new RegExp(pat,flags.includes('i')?'i':'')}catch{re=new RegExp(pat.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),flags.includes('i')?'i':'')}
        const lines=String(stdin??'').split('\n').filter(l=>flags.includes('v')?!re.test(l):re.test(l));
        if(flags.includes('c'))return String(lines.length);
        return lines.length?lines.join('\n'):{out:'',code:1};
      }
      case'wc':{const s=String(stdin??'');const lines=s?s.split('\n').length:0;return rest.includes('-l')?String(lines):`${pad(lines,7)} ${pad(s.split(/\s+/).filter(Boolean).length,7)} ${s.length}`}
      case'head':case'tail':{const n=+(rest.find(x=>/^-?\d+$/.test(x))||'10').replace('-','')||+(rest[rest.indexOf('-n')+1]||10);const l=String(stdin??'').split('\n');return(cmd==='head'?l.slice(0,n):l.slice(-n)).join('\n')}
      case'base64':{const s=String(stdin??'').replace(/\n$/,'');if(rest.includes('-d')||rest.includes('--decode')){const d=unb64(s.trim());return d===null?fail('base64: invalid input'):d}return b64(s)}
      case'lab':{
        if(rest[0]==='reset'){fresh(true);return{out:'cloudlab: clúster reiniciado. Vuelves a tener un clúster minikube limpio.',reset:true}}
        if(rest[0]==='status'||!rest[0])return`cloudlab: clúster simulado "minikube" (Kubernetes ${VERSION})\nCreado: ${new Date(S.createdAt).toLocaleString('es')}\nObjetos: ${S.items.length} · Ficheros: ${Object.keys(S.files).length}\nEl estado se guarda en este navegador y se borra tras 48 h sin uso.\nComandos: lab status | lab reset`;
        fail(`lab: subcomando desconocido "${rest[0]}". Usa: lab status | lab reset`);
      }
    }
    if(KUBECTL_ALL.includes(cmd)||Object.keys(KCMDS).includes(cmd))fail(`sh: ${cmd}: command not found\ncloudlab: ¿quisiste decir "kubectl ${cmd}"?`);
    const s=suggest(cmd,SHELL_CMDS);
    fail(`sh: ${cmd}: command not found${s.length?`\ncloudlab: ¿quisiste decir "${s[0]}"?`:''}`);
  }
  function shellHelp(){
    return`Terminal de Cloud Lab: un clúster de Kubernetes simulado (minikube, Kubernetes ${VERSION}).\nNada se ejecuta de verdad: el simulador imita el comportamiento y los errores reales.\n\n  kubectl ...        La CLI de Kubernetes (también con el alias k). Prueba: kubectl --help\n  minikube ...       Nodos y complementos: minikube node add, minikube addons enable metrics-server\n  cat <<EOF > f.yaml Crea un fichero (termina con una línea EOF) y aplícalo: kubectl apply -f f.yaml\n  ls, cat, rm        Gestiona los ficheros simulados\n  grep, wc, head     Filtra la salida con tuberías: kubectl get pods -A | grep kube\n  history, clear     Historial y limpiar la pantalla\n  lab status|reset   Estado del laboratorio o empezar de cero\n\nAtajos: Tab autocompleta (dos veces muestra opciones) · ↑/↓ historial · Ctrl+C cancela · Ctrl+L limpia`;
  }

  // Ejecuta una línea (con tuberías, &&, ; y redirecciones). stdin = cuerpo de un heredoc.
  function run(line,heredoc){
    const trimmed=line.trim();
    if(!trimmed)return{out:'',code:0};
    if(!S.history.length||S.history[S.history.length-1]!==trimmed)S.history.push(trimmed);
    if(S.history.length>200)S.history.shift();
    let chains;
    try{chains=parseLine(trimmed)}catch(e){return{out:e.message,code:2,err:true}}
    const outs=[];let code=0,clear=false,reset=false;
    for(const ch of chains){
      if(ch.sep==='&&'&&code!==0)continue;
      if(ch.sep==='||'&&code===0)continue;
      let stdin=heredoc;let last={out:'',code:0};
      for(let i=0;i<ch.pipeline.length;i++){
        const p=ch.pipeline[i];
        try{
          const r=builtin(p.args.slice(),stdin);
          last=typeof r==='string'?{out:r,code:0}:{out:r.out??'',code:r.code??0,err:r.err,clear:r.clear,reset:r.reset};
        }catch(e){
          if(!(e instanceof CmdError)){console.error(e);last={out:`cloudlab: error interno del simulador (${e.message}). Prueba otra forma del comando o usa lab reset.`,code:1,err:true}}
          else last={out:e.message,code:e.code,err:true};
        }
        if(last.clear)clear=true;if(last.reset)reset=true;
        if(p.redirect){
          if(last.err&&last.code){break}
          const txt=last.out?last.out+'\n':'';
          S.files[p.redirect.file]=(p.redirect.append?(S.files[p.redirect.file]||''):'')+txt;
          last={out:'',code:0};
        }
        stdin=last.out;heredoc=undefined;
        if(i<ch.pipeline.length-1&&last.err){outs.push({out:last.out,err:true});stdin=''}
      }
      code=last.code;
      if(last.out)outs.push({out:last.out,err:!!last.err});
    }
    S.savedAt=now();
    return{out:outs.map(o=>o.out).join('\n'),parts:outs,code,clear,reset};
  }

  // ---------- Autocompletado ----------
  function complete(line){
    let toks;
    try{toks=tokenize(line).filter(t=>typeof t==='string')}catch{return{candidates:[],word:''}}
    const endsSpace=/\s$/.test(line)||line==='';
    const word=endsSpace?'':(toks.pop()||'');
    // Solo el último comando de una tubería o cadena.
    const segStart=Math.max(line.lastIndexOf('|'),line.lastIndexOf('&&')+1,line.lastIndexOf(';'));
    if(segStart>0){try{toks=tokenize(line.slice(segStart+1)).filter(t=>typeof t==='string');if(!endsSpace)toks.pop()}catch{}}
    const cands=candidates(toks,word);
    const uniq=[...new Set(cands)].filter(c=>c.startsWith(word)).sort();
    return{candidates:uniq,word};
  }
  function candidates(toks,word){
    if(!toks.length)return SHELL_CMDS;
    const c0=toks[0];
    if(['cat','rm','ls'].includes(c0))return Object.keys(S.files);
    if(c0==='lab')return toks.length===1?['status','reset']:[];
    if(c0==='minikube'){
      if(toks.length===1)return['start','status','stop','ip','dashboard','tunnel','service','addons','node','version'];
      if(toks[1]==='node')return toks.length===2?['add','list','delete']:toks[2]==='delete'?list('Node').map(n=>n.name).filter(n=>n!=='minikube'):[];
      if(toks[1]==='addons')return toks.length===2?['list','enable','disable']:Object.keys(S.addons);
      if(toks[1]==='service')return['list',...list('Service',curNs()).map(s=>s.name)];
      return[];
    }
    if(c0!=='kubectl'&&c0!=='k')return[];
    const args=toks.slice(1);
    // Localiza el subcomando y la posición, saltando flags.
    let key=null,pos=[],prevFlag=null;
    const flagsSeen={};
    for(let i=0;i<args.length;i++){
      const a=args[i];
      if(a==='--'){return[]}
      if(a.startsWith('-')){const nm=a.replace(/^-+/,'').split('=')[0];prevFlag=a.includes('=')?null:a;flagsSeen[nm]=a.split('=')[1];continue}
      if(prevFlag){const spec=findFlag(key,prevFlag);if(spec&&spec.type!=='bool'){if(spec.name==='namespace')flagsSeen.namespace=a;prevFlag=null;continue}}
      prevFlag=null;
      if(!key){key=KCMDS[a]?a:null;if(!key)return[];continue}
      const alias={ns:'namespace',deploy:'deployment',svc:'service',cm:'configmap'}[a]||a;
      if(KCMDS[key].subs&&KCMDS[`${key} ${alias}`]&&!pos.length){key=`${key} ${alias}`;continue}
      pos.push(a);
    }
    const ns=flagsSeen.namespace||flagsSeen.n||curNs();
    // Valor de una flag.
    if(prevFlag){
      const f=findFlag(key,prevFlag);
      if(f&&f.type!=='bool')return flagValues(f.name,ns);
    }
    if(word.startsWith('--')&&word.includes('=')){const[n]=word.slice(2).split('=');return flagValues(n,ns).map(v=>`--${n}=${v}`)}
    if(word.startsWith('-')){
      const spec=key?KCMDS[key].flags:[];
      return[...spec,...GLOBAL].map(f=>`--${f.name}${f.type!=='bool'?'=':''}`).filter((v,i,a)=>a.indexOf(v)===i);
    }
    if(!key)return Object.keys(KCMDS).filter(k=>!k.includes(' '));
    if(KCMDS[key].subs&&!pos.length)return KCMDS[key].subs;
    const typeCmds=['get','describe','delete','label','annotate','scale','expose','rollout status','rollout history','rollout undo','rollout restart','rollout pause','rollout resume','set image','set env','wait','explain'];
    const resTypes=['pods','deployments','replicasets','services','configmaps','secrets','namespaces','nodes','events','all','po','deploy','rs','svc','cm','ns','no'];
    if(typeCmds.includes(key)){
      const restrict=key.startsWith('rollout')||key.startsWith('set')?['deployment','deploy']:key==='scale'?['deployment','replicaset']:key==='expose'?['deployment','pod','service','replicaset']:resTypes;
      if(!pos.length){
        if(word.includes('/')){const[t]=word.split('/');const k=resolveKind(t);return k?names(k,ns).map(n=>`${t}/${n}`):[]}
        return key==='explain'?Object.values(KINDS).map(k=>k.singular):restrict;
      }
      const k=resolveKind(pos[0].split(',')[0]);
      if(k&&!pos[0].includes('/'))return names(k,ns);
      return[];
    }
    if(['logs','exec','port-forward'].includes(key)&&!pos.length)return names('Pod',ns).concat(word.includes('/')?names('Deployment',ns).map(n=>`deploy/${n}`).concat(names('Service',ns).map(n=>`svc/${n}`)):[]);
    if(['cordon','uncordon','drain','top node'].includes(key)&&!pos.length)return names('Node');
    if(key==='top pod'&&!pos.length)return names('Pod',ns);
    if(key==='config use-context')return Object.keys(S.ctx.contexts);
    if(key==='auth can-i')return pos.length?resTypes:['get','list','create','delete','update','watch'];
    return[];
  }
  function findFlag(key,raw){
    const all=[...(key?KCMDS[key].flags:[]),...GLOBAL];
    if(raw.startsWith('--'))return all.find(f=>f.name===raw.slice(2).split('=')[0]);
    return all.find(f=>f.short===raw[1]);
  }
  function flagValues(name,ns){
    if(name==='namespace'||name==='n')return names('Namespace');
    if(name==='output'||name==='o')return['wide','yaml','json','name'];
    if(name==='type')return['ClusterIP','NodePort','LoadBalancer'];
    if(name==='filename'||name==='f')return['-',...Object.keys(S.files)];
    if(name==='image')return['nginx','nginx:1.27','nginx:1.29','httpd','redis','busybox','alpine','hashicorp/http-echo'];
    if(name==='dry-run')return['client','server','none'];
    if(name==='restart')return['Always','OnFailure','Never'];
    if(name==='context')return Object.keys(S.ctx.contexts);
    if(name==='selector'||name==='l')return[...new Set(S.items.filter(o=>o.namespace===ns&&o.kind==='Pod').flatMap(o=>Object.entries(o.labels).filter(([k])=>k!=='pod-template-hash').map(([k,v])=>`${k}=${v}`)))];
    return[];
  }
  const names=(kind,ns)=>list(kind,KINDS[kind].ns?ns:null).map(o=>o.name);

  // ---------- Persistencia ----------
  const TTL=48*3600*1000;
  function load(saved){
    if(saved&&saved.v===1&&now()-saved.savedAt<TTL){S=saved;S.history=S.history||[];S.files=S.files||{};S.addons=S.addons||{'metrics-server':false,'dashboard':false,'ingress':false};S.cluster=S.cluster||'minikube';S.parked=S.parked||{};S.aksAt=S.aksAt||S.savedAt;return true}
    fresh();return false;
  }
  const restored=load(opts.saved);
  syncAks();
  if(S.cluster!=='minikube'&&!aksInfo(S.cluster))useCluster('minikube');
  reconcile();

  return{
    run,complete,syncAks,
    // Ejecuta un comando ya tokenizado (lo usa la terminal de Azure para kubectl).
    exec(args,stdin){
      S.savedAt=now();
      try{const r=builtin(args.slice(),stdin);return typeof r==='string'?{out:r,code:0}:{out:r.out??'',code:r.code??0,err:r.err}}
      catch(e){if(!(e instanceof CmdError)){console.error(e);return{out:`cloudlab: error interno del simulador (${e.message}).`,code:1,err:true}}return{out:e.message,code:e.code,err:true}}
    },
    get state(){return S},
    restored,
    serialize:()=>JSON.parse(JSON.stringify(S)),
    podView,depStatus,endpoints,
    ttlHours:TTL/3600000,
    expiresAt:()=>S.savedAt+TTL,
    VERSION,
    tick(){reconcile()},
  };
}

const api={create,VERSION,tokenize,parseLine};
if(typeof module==='object'&&module.exports)module.exports=api;
else root.K8sSim=api;
})(typeof globalThis!=='undefined'?globalThis:this);
