// Motor de simulación de Azure CLI: suscripciones, grupos de recursos y recursos (VM, storage, VNet, App Service,
// AKS, RBAC), intérprete de "az" con argumentos, errores y salidas (json, table, tsv, yaml, --query JMESPath)
// al estilo de Azure CLI, preguntas interactivas (y/n, contraseñas, selección de suscripción) y autocompletado.
// No ejecuta nada real. Uso: const sim = AzSim.create({yaml: jsyaml, saved, kubectl}); sim.run('az group list -o table')
(function(root){
'use strict';
const K=typeof module==='object'&&module.exports?require('./k8s-engine.js'):root.K8sSim;
const CLI_VERSION='2.91.0';
const AKS_VERSIONS=[['1.36.1',[]],['1.35.4',['1.36.1']],['1.34.7',['1.35.4']],['1.33.9',['1.34.7']]];
const AKS_DEFAULT='1.35.4';
const QUOTA=10;

// ---------- Catálogos ----------
// [nombre, nombre visible, geografía, región emparejada, zonas de disponibilidad]
const REGIONS=[['eastus','East US','US','westus',1],['eastus2','East US 2','US','centralus',1],['westus','West US','US','eastus',0],['westus2','West US 2','US','westcentralus',1],['westus3','West US 3','US','eastus',1],['centralus','Central US','US','eastus2',1],['northcentralus','North Central US','US','southcentralus',0],['southcentralus','South Central US','US','northcentralus',1],['westcentralus','West Central US','US','westus2',0],['canadacentral','Canada Central','Canada','canadaeast',1],['canadaeast','Canada East','Canada','canadacentral',0],['brazilsouth','Brazil South','South America','southcentralus',1],['mexicocentral','Mexico Central','Mexico',null,1],['chilecentral','Chile Central','Chile',null,1],['northeurope','North Europe','Europe','westeurope',1],['westeurope','West Europe','Europe','northeurope',1],['uksouth','UK South','UK','ukwest',1],['ukwest','UK West','UK','uksouth',0],['francecentral','France Central','Europe','francesouth',1],['germanywestcentral','Germany West Central','Europe','germanynorth',1],['italynorth','Italy North','Europe',null,1],['spaincentral','Spain Central','Europe',null,1],['swedencentral','Sweden Central','Europe','swedensouth',1],['switzerlandnorth','Switzerland North','Europe','switzerlandwest',1],['norwayeast','Norway East','Europe','norwaywest',1],['polandcentral','Poland Central','Europe',null,1],['uaenorth','UAE North','Middle East','uaecentral',1],['qatarcentral','Qatar Central','Middle East',null,1],['israelcentral','Israel Central','Middle East',null,1],['southafricanorth','South Africa North','Africa','southafricawest',1],['centralindia','Central India','Asia Pacific','southindia',1],['southindia','South India','Asia Pacific','centralindia',0],['eastasia','East Asia','Asia Pacific','southeastasia',1],['southeastasia','Southeast Asia','Asia Pacific','eastasia',1],['japaneast','Japan East','Asia Pacific','japanwest',1],['japanwest','Japan West','Asia Pacific','japaneast',0],['koreacentral','Korea Central','Asia Pacific','koreasouth',1],['australiaeast','Australia East','Asia Pacific','australiasoutheast',1],['australiasoutheast','Australia Southeast','Asia Pacific','australiaeast',0],['newzealandnorth','New Zealand North','New Zealand',null,1]];
const REGION=Object.fromEntries(REGIONS.map(r=>[r[0],{name:r[0],display:r[1],geo:r[2],pair:r[3],zones:!!r[4]}]));
const normLoc=l=>String(l||'').toLowerCase().replace(/\s+/g,'');
// Tamaños de VM: [vCPU, MB de memoria, familia de cuota]
const SIZES={Standard_B1ls:[1,512,'standardBSFamily'],Standard_B1s:[1,1024,'standardBSFamily'],Standard_B1ms:[1,2048,'standardBSFamily'],Standard_B2s:[2,4096,'standardBSFamily'],Standard_B2ms:[2,8192,'standardBSFamily'],Standard_B4ms:[4,16384,'standardBSFamily'],Standard_B2ats_v2:[2,1024,'standardBasv2Family'],Standard_B2s_v2:[2,8192,'standardBsv2Family'],Standard_DS1_v2:[1,3584,'standardDSv2Family'],Standard_DS2_v2:[2,7168,'standardDSv2Family'],Standard_DS3_v2:[4,14336,'standardDSv2Family'],Standard_D2s_v3:[2,8192,'standardDSv3Family'],Standard_D4s_v3:[4,16384,'standardDSv3Family'],Standard_D2s_v5:[2,8192,'standardDSv5Family'],Standard_D4s_v5:[4,16384,'standardDSv5Family'],Standard_D8s_v5:[8,32768,'standardDSv5Family'],Standard_D2as_v5:[2,8192,'standardDASv5Family'],Standard_D2ds_v5:[2,8192,'standardDDSv5Family'],Standard_E2s_v5:[2,16384,'standardESv5Family'],Standard_E4s_v5:[4,32768,'standardESv5Family'],Standard_F2s_v2:[2,4096,'standardFSv2Family'],Standard_F4s_v2:[4,8192,'standardFSv2Family'],Standard_NC4as_T4_v3:[4,28672,'standardNCASv3_T4Family']};
const FAMILY_NAME=f=>f==='standardBSFamily'?'Standard BS Family vCPUs':`Standard ${f.replace(/^standard/,'').replace(/Family$/,'').replace('_',' ')} Family vCPUs`;
const FAMILY_LIMIT=f=>/NCAS/.test(f)?0:QUOTA;
const sizeName=s=>Object.keys(SIZES).find(k=>k.toLowerCase()===String(s).toLowerCase());
// Alias de imágenes (lista sin conexión de "az vm image list").
const IMAGES={CentOS85Gen2:'OpenLogic:CentOS:8_5-gen2:latest',Debian11:'Debian:debian-11:11-backports-gen2:latest',Debian12:'Debian:debian-12:12-gen2:latest',FlatcarLinuxFreeGen2:'kinvolk:flatcar-container-linux-free:stable-gen2:latest',OpenSuseLeap154Gen2:'SUSE:openSUSE-leap-15-4:gen2:latest',RHELRaw8LVMGen2:'RedHat:RHEL:8-lvm-gen2:latest',SuseSles15SP5:'SUSE:sles-15-sp5:gen2:latest',Ubuntu2204:'Canonical:0001-com-ubuntu-server-jammy:22_04-lts-gen2:latest',Ubuntu2404:'Canonical:ubuntu-24_04-lts:server:latest',Win2025Datacenter:'MicrosoftWindowsServer:WindowsServer:2025-datacenter-g2:latest',Win2022Datacenter:'MicrosoftWindowsServer:WindowsServer:2022-datacenter-g2:latest',Win2022AzureEditionCore:'MicrosoftWindowsServer:WindowsServer:2022-datacenter-azure-edition-core:latest',Win2019Datacenter:'MicrosoftWindowsServer:WindowsServer:2019-datacenter-gensecond:latest',Win2016Datacenter:'MicrosoftWindowsServer:WindowsServer:2016-datacenter-gensecond:latest',Win2012R2Datacenter:'MicrosoftWindowsServer:WindowsServer:2012-r2-datacenter-gensecond:latest',Win2012Datacenter:'MicrosoftWindowsServer:WindowsServer:2012-datacenter-gensecond:latest'};
const RESERVED_USERS=['administrator','admin','user','user1','test','user2','test1','user3','admin1','1','123','a','actuser','adm','admin2','aspnet','backup','console','david','guest','john','owner','root','server','sql','support','support_388945a0','sys','test2','test3','user4','user5'];
// Roles integrados de Azure (los identificadores son los reales).
const ROLES={'Owner':'8e3af657-a8ff-443c-a75c-2fe8c4bcb635','Contributor':'b24988ac-6180-42a0-ab88-20f7382dd24c','Reader':'acdd72a7-3385-48ef-bd42-f606fba81ae7','User Access Administrator':'18d7d88d-d35e-4fb5-a5c3-7773c20a72d9','Role Based Access Control Administrator':'f58310d9-a9f6-439a-9e8d-f62e7b41a168','Virtual Machine Contributor':'9980e02c-c2be-4d73-94e8-173b1dc7cf3c','Network Contributor':'4d97b98b-1d4f-4787-a291-c67834d212e7','Storage Account Contributor':'17d1049b-9a84-46fb-8f53-869881c3d3ab','Storage Blob Data Contributor':'ba92f5b4-2d11-453d-a403-e96b0029c9fe','Storage Blob Data Reader':'2a2b9908-6ea1-4ae2-8e65-a410df84e7d1','Website Contributor':'de139f84-1756-47ae-9be6-808fbbe84772','Azure Kubernetes Service Cluster User Role':'4abbcc35-e782-43d8-92c5-2d3f1bd2253f','Azure Kubernetes Service RBAC Reader':'7f6c6a51-bcf8-42ba-9220-52d62157d7db'};
const DOMAIN='cloudlabdemo.onmicrosoft.com';
const USERS=[['user','Cloud Lab User','Cloud Lab','User'],['ana.garcia','Ana García','Ana','García'],['luis.perez','Luis Pérez','Luis','Pérez'],['marta.ruiz','Marta Ruiz','Marta','Ruiz']].map(([u,d,g,s],i)=>({upn:`${u}@${DOMAIN}`,displayName:d,givenName:g,surname:s,id:['3b0f9d6e-6c1a-4a8e-9f4a-2f1c0d7b8e11','5c2e4a7d-1b3f-4c6e-8a9d-0e1f2a3b4c5d','7d4f6b8e-2c5a-4d7f-9b1e-1f2a3b4c5d6e','9e6a8c0f-3d7b-4e8a-a2c3-2a3b4c5d6e7f'][i]}));
const RUNTIMES={linux:['NODE:22-lts','NODE:20-lts','PYTHON:3.13','PYTHON:3.12','PYTHON:3.11','DOTNETCORE:9.0','DOTNETCORE:8.0','JAVA:21-java21','JAVA:17-java17','PHP:8.4','PHP:8.3'],windows:['dotnet:9','dotnet:8','ASPNET:V4.8','NODE:22LTS','NODE:20LTS','JAVA:21','JAVA:17','PYTHON:3.12']};
const PLAN_SKUS=['B1','B2','B3','D1','F1','FREE','P0V3','P1V2','P1V3','P2V2','P2V3','P3V2','P3V3','P0V4','P1V4','P2V4','P3V4','P1MV3','P2MV3','S1','S2','S3','SHARED','I1V2','I2V2','I3V2','WS1','WS2','WS3'];
const STORAGE_SKUS=['Premium_LRS','Premium_ZRS','Standard_GRS','Standard_GZRS','Standard_LRS','Standard_RAGRS','Standard_RAGZRS','Standard_ZRS'];
// Nombres globales que "ya usa otra persona" en Azure (storage y web apps son únicos en todo Azure).
const TAKEN_STORAGE=['storage','mystorage','mystorageaccount','storageaccount','teststorage','test','azure','demo','cloudlab','backup','data','images','logs','prod','dev','files','media'];
const TAKEN_SITES=['portal','myapp','webapp','test','app','demo','hello','azure','cloudlab','api','www','helloworld','mywebapp'];
const TYPES={group:'Microsoft.Resources/resourceGroups',vm:'Microsoft.Compute/virtualMachines',disk:'Microsoft.Compute/disks',storage:'Microsoft.Storage/storageAccounts',vnet:'Microsoft.Network/virtualNetworks',nsg:'Microsoft.Network/networkSecurityGroups',pip:'Microsoft.Network/publicIPAddresses',nic:'Microsoft.Network/networkInterfaces',plan:'Microsoft.Web/serverFarms',webapp:'Microsoft.Web/sites',aks:'Microsoft.ContainerService/managedClusters',vmss:'Microsoft.Compute/virtualMachineScaleSets',lb:'Microsoft.Network/loadBalancers'};

// ---------- Utilidades ----------
const hexs=n=>Array.from({length:n},()=>'0123456789abcdef'[Math.random()*16|0]).join('');
const guid=()=>`${hexs(8)}-${hexs(4)}-4${hexs(3)}-${'89ab'[Math.random()*4|0]}${hexs(3)}-${hexs(12)}`;
const iso=t=>new Date(t).toISOString().replace(/\.(\d{3})Z$/,'.$1000+00:00');
const lc=s=>String(s||'').toLowerCase();
const pad=(s,n)=>String(s)+' '.repeat(Math.max(0,n-String(s).length));
const clone=o=>JSON.parse(JSON.stringify(o));
function lev(a,b){
  const d=Array.from({length:a.length+1},(_,i)=>[i]);
  for(let j=1;j<=b.length;j++)d[0][j]=j;
  for(let i=1;i<=a.length;i++)for(let j=1;j<=b.length;j++)d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+(a[i-1]===b[j-1]?0:1));
  return d[a.length][b.length];
}
const similar=(w,list)=>list.filter(x=>1-lev(w,x)/Math.max(w.length,x.length)>=0.6||(w.length>2&&x.startsWith(w))).sort((a,b)=>lev(w,a)-lev(w,b)).slice(0,3);
function ip2n(ip){const p=ip.split('.').map(Number);return((p[0]<<24)>>>0)+(p[1]<<16)+(p[2]<<8)+p[3]}
const n2ip=n=>[n>>>24,(n>>>16)&255,(n>>>8)&255,n&255].join('.');
function cidr(s){
  const m=String(s).match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/);
  if(!m||m.slice(1,5).some(x=>+x>255)||+m[5]>32)return null;
  const bits=+m[5],base=ip2n(m.slice(1,5).join('.')),mask=bits?(~0<<(32-bits))>>>0:0;
  return{bits,base,start:(base&mask)>>>0,end:((base&mask)|(~mask>>>0))>>>0,net:n2ip((base&mask)>>>0)+'/'+bits};
}

class AzError extends Error{constructor(msg,code=1){super(msg);this.code=code}}
class Ask{constructor(text,cont,secret){this.text=text;this.cont=cont;this.secret=!!secret}}
const fail=(m,code=1)=>{throw new AzError(m,code)};
const err=(m,code=1)=>fail('ERROR: '+m,code);
// Error de Azure Resource Manager: "(Código) mensaje", luego Code/Message/Target y, al final, las notas de cloudlab.
const arm=(c,m,code=1)=>{
  const lines=m.split('\n'),i=lines.findIndex(l=>/^(Target|cloudlab):/.test(l)),head=(i<0?lines:lines.slice(0,i)).join('\n'),tail=i<0?[]:lines.slice(i);
  const target=tail.filter(l=>l.startsWith('Target:')),notes=tail.filter(l=>!l.startsWith('Target:'));
  err([`(${c}) ${head}`,`Code: ${c}`,`Message: ${head}`,...target,...notes].join('\n'),code);
};

// ---------- JMESPath (implementación compacta para --query) ----------
const JP=(()=>{
  const BP={eof:0,ident:0,quoted:0,literal:0,rbracket:0,rparen:0,comma:0,rbrace:0,number:0,current:0,expref:0,colon:0,pipe:1,or:2,and:3,eq:5,ne:5,lt:5,lte:5,gt:5,gte:5,flatten:9,star:20,filter:21,dot:40,not:45,lbrace:50,lbracket:55,lparen:60};
  function lex(s){
    const t=[];let i=0;
    const push=(type,value,len=1)=>{t.push({type,value,pos:i});i+=len};
    while(i<s.length){
      const c=s[i],two=s.slice(i,i+2);
      if(/\s/.test(c)){i++;continue}
      if(/[A-Za-z_]/.test(c)){let j=i;while(j<s.length&&/[A-Za-z0-9_]/.test(s[j]))j++;push('ident',s.slice(i,j),j-i);continue}
      if(/[0-9-]/.test(c)&&/[0-9]/.test(c==='-'?s[i+1]||'':c)){let j=i+1;while(j<s.length&&/[0-9]/.test(s[j]))j++;push('number',+s.slice(i,j),j-i);continue}
      if(c==='"'){let j=i+1;while(j<s.length&&s[j]!=='"'){if(s[j]==='\\')j++;j++}if(j>=s.length)throw new Error('unclosed');push('quoted',JSON.parse(s.slice(i,j+1)),j+1-i);continue}
      if(c==="'"){let j=i+1;while(j<s.length&&s[j]!=="'"){if(s[j]==='\\')j++;j++}if(j>=s.length)throw new Error('unclosed');push('literal',s.slice(i+1,j).replace(/\\'/g,"'"),j+1-i);continue}
      if(c==='`'){let j=i+1;while(j<s.length&&s[j]!=='`'){if(s[j]==='\\')j++;j++}if(j>=s.length)throw new Error('unclosed');const raw=s.slice(i+1,j).replace(/\\`/g,'`');let v;try{v=JSON.parse(raw)}catch{v=raw}push('literal',v,j+1-i);continue}
      if(two==='[?'){push('filter',null,2);continue}
      if(two==='[]'){push('flatten',null,2);continue}
      if(two==='||'){push('or',null,2);continue}
      if(two==='&&'){push('and',null,2);continue}
      if(two==='=='){push('eq',null,2);continue}
      if(two==='!='){push('ne',null,2);continue}
      if(two==='<='){push('lte',null,2);continue}
      if(two==='>='){push('gte',null,2);continue}
      const one={'.':'dot','*':'star','[':'lbracket',']':'rbracket','{':'lbrace','}':'rbrace','(':'lparen',')':'rparen',',':'comma',':':'colon','|':'pipe','@':'current','&':'expref','!':'not','<':'lt','>':'gt'}[c];
      if(one){push(one,null);continue}
      throw new Error('unexpected '+c);
    }
    t.push({type:'eof',pos:i});
    return t;
  }
  function parse(src){
    const toks=lex(src);let p=0;
    const peek=(k=0)=>toks[p+k].type;
    const next=()=>toks[p++];
    const expect=ty=>{if(peek()!==ty)throw new Error(`expected ${ty}`);return next()};
    function expr(rbp){
      let left=nud(next());
      while(rbp<BP[peek()])left=led(next(),left);
      return left;
    }
    function nud(t){
      switch(t.type){
        case'literal':return{k:'lit',v:t.value};
        case'ident':return{k:'field',n:t.value};
        case'quoted':if(peek()==='lparen')throw new Error('quoted function');return{k:'field',n:t.value};
        case'star':return{k:'vproj',l:{k:'cur'},r:rhs(BP.star)};
        case'filter':return filterTail({k:'cur'});
        case'lbrace':return hash();
        case'flatten':return{k:'proj',l:{k:'flat',e:{k:'cur'}},r:rhs(BP.flatten)};
        case'lbracket':
          if(peek()==='number'||peek()==='colon'){const idx=index();return idx.k==='slice'?{k:'proj',l:{k:'sub',l:{k:'cur'},r:idx},r:rhs(BP.star)}:idx}
          if(peek()==='star'&&peek(1)==='rbracket'){p+=2;return{k:'proj',l:{k:'cur'},r:rhs(BP.star)}}
          return list();
        case'current':return{k:'cur'};
        case'expref':return{k:'ref',e:expr(BP.expref)};
        case'not':return{k:'not',e:expr(BP.not)};
        case'lparen':{const e=expr(0);expect('rparen');return e}
      }
      throw new Error('unexpected token '+t.type);
    }
    function led(t,left){
      switch(t.type){
        case'dot':if(peek()==='star'){next();return{k:'vproj',l:left,r:rhs(BP.dot)}}return{k:'sub',l:left,r:dotRhs(BP.dot)};
        case'pipe':return{k:'pipe',l:left,r:expr(BP.pipe)};
        case'or':return{k:'or',l:left,r:expr(BP.or)};
        case'and':return{k:'and',l:left,r:expr(BP.and)};
        case'lparen':{if(left.k!=='field')throw new Error('bad function');const args=[];while(peek()!=='rparen'){args.push(expr(0));if(peek()==='comma')next()}next();return{k:'fn',n:left.n,args}}
        case'filter':return filterTail(left);
        case'flatten':return{k:'proj',l:{k:'flat',e:left},r:rhs(BP.flatten)};
        case'eq':case'ne':case'lt':case'lte':case'gt':case'gte':return{k:'cmp',op:t.type,l:left,r:expr(BP[t.type])};
        case'lbracket':
          if(peek()==='number'||peek()==='colon'){const idx=index();return idx.k==='slice'?{k:'proj',l:{k:'sub',l:left,r:idx},r:rhs(BP.star)}:{k:'sub',l:left,r:idx}}
          expect('star');expect('rbracket');return{k:'proj',l:left,r:rhs(BP.star)};
      }
      throw new Error('unexpected token '+t.type);
    }
    function filterTail(left){const cond=expr(0);expect('rbracket');return{k:'fproj',l:left,c:cond,r:rhs(BP.filter)}}
    function index(){
      const parts=[null,null,null];let i=0;
      while(peek()!=='rbracket'){
        if(peek()==='colon'){i++;if(i>2)throw new Error('slice');next()}
        else{parts[i]=expect('number').value}
      }
      next();
      return i===0?{k:'idx',i:parts[0]}:{k:'slice',a:parts};
    }
    function rhs(bp){
      if(BP[peek()]<10)return{k:'cur'};
      if(peek()==='lbracket'||peek()==='filter')return expr(bp);
      if(peek()==='dot'){next();return dotRhs(bp)}
      throw new Error('syntax');
    }
    function dotRhs(bp){
      const ty=peek();
      if(ty==='ident'||ty==='quoted'||ty==='star')return expr(bp);
      if(ty==='lbracket'){next();return list()}
      if(ty==='lbrace'){next();return hash()}
      throw new Error('syntax');
    }
    function list(){const items=[];while(peek()!=='rbracket'){items.push(expr(0));if(peek()==='comma')next();else if(peek()!=='rbracket')throw new Error('syntax')}next();return{k:'mlist',items}}
    function hash(){const pairs=[];while(peek()!=='rbrace'){const key=next();if(key.type!=='ident'&&key.type!=='quoted')throw new Error('syntax');expect('colon');pairs.push([key.value,expr(0)]);if(peek()==='comma')next();else if(peek()!=='rbrace')throw new Error('syntax')}next();return{k:'mhash',pairs}}
    const ast=expr(0);
    if(peek()!=='eof')throw new Error('trailing');
    return ast;
  }
  const isObj=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
  const truthy=v=>!(v===null||v===undefined||v===false||v===''||(Array.isArray(v)&&!v.length)||(isObj(v)&&!Object.keys(v).length));
  const eq=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const type=v=>v===null||v===undefined?'null':Array.isArray(v)?'array':typeof v==='object'?'object':typeof v;
  const FN={
    length:v=>typeof v==='string'||Array.isArray(v)?v.length:isObj(v)?Object.keys(v).length:null,
    contains:(s,x)=>typeof s==='string'?s.includes(x):Array.isArray(s)?s.some(y=>eq(y,x)):null,
    starts_with:(s,x)=>typeof s==='string'&&s.startsWith(x),
    ends_with:(s,x)=>typeof s==='string'&&s.endsWith(x),
    join:(sep,a)=>Array.isArray(a)?a.join(sep):null,
    keys:o=>isObj(o)?Object.keys(o):null,values:o=>isObj(o)?Object.values(o):null,
    sort:a=>Array.isArray(a)?a.slice().sort((x,y)=>x<y?-1:x>y?1:0):null,
    reverse:a=>Array.isArray(a)?a.slice().reverse():typeof a==='string'?[...a].reverse().join(''):null,
    max:a=>Array.isArray(a)&&a.length?a.reduce((x,y)=>y>x?y:x):null,min:a=>Array.isArray(a)&&a.length?a.reduce((x,y)=>y<x?y:x):null,
    sum:a=>Array.isArray(a)?a.reduce((x,y)=>x+y,0):null,avg:a=>Array.isArray(a)&&a.length?a.reduce((x,y)=>x+y,0)/a.length:null,
    to_string:v=>typeof v==='string'?v:JSON.stringify(v),to_number:v=>typeof v==='number'?v:isNaN(+v)?null:+v,
    type,not_null:(...a)=>a.find(x=>x!==null&&x!==undefined)??null,abs:Math.abs,floor:Math.floor,ceil:Math.ceil,
    lower:s=>String(s).toLowerCase(),upper:s=>String(s).toUpperCase(),
  };
  const BYFN={sort_by:(a,f)=>a.slice().sort((x,y)=>{const p=f(x),q=f(y);return p<q?-1:p>q?1:0}),max_by:(a,f)=>a.length?a.reduce((x,y)=>f(y)>f(x)?y:x):null,min_by:(a,f)=>a.length?a.reduce((x,y)=>f(y)<f(x)?y:x):null,map:(f,a)=>a.map(f)};
  function ev(n,v){
    switch(n.k){
      case'lit':return n.v;
      case'cur':return v;
      case'field':return isObj(v)?(v[n.n]??null):null;
      case'sub':return ev(n.r,ev(n.l,v));
      case'idx':{if(!Array.isArray(v))return null;const i=n.i<0?v.length+n.i:n.i;return v[i]??null}
      case'slice':{if(!Array.isArray(v))return null;let[a,b,s]=n.a;s=s??1;const L=v.length;const out=[];if(s>0){a=a==null?0:a<0?Math.max(0,L+a):Math.min(a,L);b=b==null?L:b<0?Math.max(0,L+b):Math.min(b,L);for(let i=a;i<b;i+=s)out.push(v[i])}else{a=a==null?L-1:a<0?L+a:Math.min(a,L-1);b=b==null?-1:b<0?L+b:b;for(let i=a;i>b;i+=s)out.push(v[i])}return out}
      case'proj':{const l=ev(n.l,v);if(!Array.isArray(l))return null;return l.map(x=>ev(n.r,x)).filter(x=>x!==null&&x!==undefined)}
      case'vproj':{const l=ev(n.l,v);if(!isObj(l))return null;return Object.values(l).map(x=>ev(n.r,x)).filter(x=>x!==null&&x!==undefined)}
      case'fproj':{const l=ev(n.l,v);if(!Array.isArray(l))return null;return l.filter(x=>truthy(ev(n.c,x))).map(x=>ev(n.r,x)).filter(x=>x!==null&&x!==undefined)}
      case'flat':{const l=ev(n.e,v);if(!Array.isArray(l))return null;return l.flatMap(x=>Array.isArray(x)?x:[x])}
      case'pipe':return ev(n.r,ev(n.l,v));
      case'or':{const l=ev(n.l,v);return truthy(l)?l:ev(n.r,v)}
      case'and':{const l=ev(n.l,v);return truthy(l)?ev(n.r,v):l}
      case'not':return!truthy(ev(n.e,v));
      case'cmp':{const a=ev(n.l,v),b=ev(n.r,v);if(n.op==='eq')return eq(a,b);if(n.op==='ne')return!eq(a,b);if(typeof a!=='number'||typeof b!=='number')return null;return{lt:a<b,lte:a<=b,gt:a>b,gte:a>=b}[n.op]}
      case'mlist':return v===null?null:n.items.map(e=>ev(e,v));
      case'mhash':return v===null?null:Object.fromEntries(n.pairs.map(([k,e])=>[k,ev(e,v)]));
      case'ref':return n;
      case'fn':{
        if(BYFN[n.n]){const a=n.args.map(x=>x.k==='ref'?(y=>ev(x.e,y)):ev(x,v));return n.n==='map'?BYFN.map(a[0],a[1]||[]):Array.isArray(a[0])?BYFN[n.n](a[0],a[1]):null}
        if(!FN[n.n])throw new Error(`Unknown function: ${n.n}()`);
        return FN[n.n](...n.args.map(x=>ev(x,v)));
      }
    }
    return null;
  }
  return{search:(data,expr)=>ev(parse(expr),data),compile:parse};
})();

// ---------- Definición de comandos ----------
// A(dest, opciones, {req, type: str|bool|tbool|list|int, choices, desc, cfg})
const A=(dest,opts,x={})=>({dest,opts,type:'str',...x});
const RG=(req=true)=>A('rg',['--resource-group','-g'],{req,cfg:'group',desc:'Name of resource group. You can configure the default group using `az configure --defaults group=<name>`.'});
const LOC=(req=false)=>A('location',['--location','-l'],{req,cfg:'location',desc:'Location. Values from: `az account list-locations`. You can configure the default location using `az configure --defaults location=<location>`.'});
const NAME=(desc,req=true)=>A('name',['--name','-n'],{req,desc});
const YES=A('yes',['--yes','-y'],{type:'bool',desc:'Do not prompt for confirmation.'});
const NOWAIT=A('noWait',['--no-wait'],{type:'bool',desc:'Do not wait for the long-running operation to finish.'});
const TAGS=A('tags',['--tags'],{type:'list',empty:true,desc:'Space-separated tags: key[=value] [key[=value] ...]. Use "" to clear existing tags.'});
const GLOBAL=[
  A('debug',['--debug'],{type:'bool',desc:'Increase logging verbosity to show all debug logs.'}),
  A('help',['--help','-h'],{type:'bool',desc:'Show this help message and exit.'}),
  A('onlyErrors',['--only-show-errors'],{type:'bool',desc:'Only show errors, suppressing warnings.'}),
  A('output',['--output','-o'],{choices:['json','jsonc','none','table','tsv','yaml','yamlc'],desc:'Output format.  Allowed values: json, jsonc, none, table, tsv, yaml, yamlc.  Default: json.'}),
  A('query',['--query'],{desc:'JMESPath query string. See http://jmespath.org/ for more information and examples.'}),
  A('subscription',['--subscription'],{desc:'Name or ID of subscription. You can configure the default subscription using `az account set -s NAME_OR_ID`.'}),
  A('verbose',['--verbose'],{type:'bool',desc:'Increase logging verbosity. Use --debug for full debug logs.'}),
];
const GROUPS={
  '':'',account:'Manage Azure subscription information.',group:'Manage resource groups and template deployments.',vm:'Manage Linux or Windows virtual machines.','vm image':'Information on available virtual machine images.',storage:'Manage Azure Cloud Storage resources.','storage account':'Manage storage accounts.',network:'Manage Azure Network resources.','network vnet':'Check if a private IP address is available for use within a virtual network.','network vnet subnet':'Manage subnets in an Azure Virtual Network.',appservice:'Manage App Service plans.','appservice plan':'Manage app service plans.',webapp:'Manage web apps.',aks:'Azure Kubernetes Service.',role:'Manage Azure role-based access control (Azure RBAC).','role assignment':'Manage role assignments.','role definition':'Manage role definitions.',ad:'Manage Microsoft Entra ID (formerly known as Azure Active Directory, Azure AD, AAD) entities needed for Azure role-based access control (Azure RBAC) through Microsoft Graph API.','ad user':'Manage Microsoft Entra users.',resource:'Manage Azure resources.',
};
const ROOT_EXTRA={login:'Log in to Azure.',logout:'Log out to remove access to Azure subscriptions.',configure:'Manage Azure CLI configuration. This command is interactive.',find:'I\'m an AI robot, my advice is based on our Azure documentation as well as the usage patterns of Azure CLI and Azure ARM users. Using me improves Azure products and documentation.',version:'Show the versions of Azure CLI modules and extensions in JSON format by default or format configured by --output.'};
// Comandos reales de Azure CLI que existen pero no se simulan (para un mensaje honesto en lugar de "no existe").
const REAL={'':['account','acr','ad','advisor','afd','aks','ams','apim','appconfig','appservice','aro','backup','batch','bicep','billing','bot','cache','capacity','cdn','cloud','cognitiveservices','config','configure','consumption','container','containerapp','cosmosdb','deployment','disk','eventgrid','eventhubs','extension','feature','feedback','find','functionapp','group','identity','image','interactive','iot','keyvault','lock','login','logout','managedapp','monitor','mysql','network','policy','postgres','provider','redis','relay','resource','role','search','security','servicebus','sig','snapshot','sql','sshkey','staticwebapp','storage','synapse','tag','upgrade','version','vm','vmss','webapp'],
  account:['alias','clear','get-access-token','list','list-locations','lock','management-group','set','show','subscription','tenant'],group:['create','delete','exists','export','list','lock','show','update','wait'],
  vm:['availability-set','boot-diagnostics','capture','create','deallocate','delete','disk','extension','generalize','get-instance-view','identity','image','list','list-ip-addresses','list-sizes','list-skus','list-usage','list-vm-resize-options','nic','open-port','reapply','redeploy','reimage','resize','restart','run-command','show','start','stop','update','user','wait'],
  storage:['account','blob','container','copy','cors','directory','entity','file','fs','logging','message','metrics','queue','remove','share','share-rm','table'],'storage account':['blob-service-properties','check-name','create','delete','encryption-scope','failover','file-service-properties','generate-sas','keys','list','management-policy','network-rule','or-policy','private-endpoint-connection','show','show-connection-string','show-usage','update'],
  network:['application-gateway','asg','bastion','dns','express-route','firewall','lb','local-gateway','nat','nic','nsg','private-dns','private-endpoint','public-ip','route-table','traffic-manager','vnet','vnet-gateway','vpn-connection','watcher'],'network vnet':['check-ip-address','create','delete','list','list-available-ips','list-endpoint-services','peering','show','subnet','update','wait'],'network vnet subnet':['create','delete','list','list-available-delegations','show','update','wait'],
  appservice:['ase','domain','hybrid-connection','list-locations','plan','vnet-integration'],'appservice plan':['create','delete','identity','list','show','update'],
  webapp:['auth','browse','config','connection','create','create-remote-connection','delete','deploy','deployment','list','list-instances','list-runtimes','log','restart','show','ssh','start','stop','traffic-routing','up','update','vnet-integration','webjob'],
  aks:['addon','approuting','browse','check-acr','command','connection','create','delete','disable-addons','enable-addons','get-credentials','get-upgrades','get-versions','install-cli','list','maintenanceconfiguration','mesh','nodepool','operation','rotate-certs','scale','show','snapshot','start','stop','update','upgrade','wait'],
  role:['assignment','definition'],'role assignment':['create','delete','list','list-changelogs','update'],'role definition':['create','delete','list','update'],ad:['app','group','signed-in-user','sp','user'],'ad user':['create','delete','get-member-groups','list','show','update'],resource:['create','delete','invoke-action','link','list','lock','move','show','tag','update','wait'],
};
const C={};
const cmd=(key,desc,args,ex,fn,extra={})=>{C[key]={key,desc,args,ex,fn,...extra}};

// ---------- Simulador ----------
function create(opts={}){
  const yaml=opts.yaml||root.jsyaml;
  const now=opts.now||(()=>Date.now());
  let S,pending=null;
  const sub=()=>S.subs.find(s=>s.id===S.current);
  const curSub=()=>S.cur||S.current;

  function fresh(){
    const t=now();
    S={v:1,createdAt:t,savedAt:t,loggedIn:false,tenant:{id:guid(),name:'Default Directory',domain:DOMAIN},
      subs:[{id:guid(),name:'Azure subscription 1',offer:'Pay-As-You-Go'},{id:guid(),name:'Cloud Lab Dev',offer:'Visual Studio Enterprise'}],
      current:null,defaults:{},res:[],roles:[],merged:[],gone:[],sshKeys:false,vars:{},files:{},history:[],stats:{}};
    S.current=S.subs[0].id;
    for(const s of S.subs)S.roles.push({id:guid(),scope:`/subscriptions/${s.id}`,role:'Owner',principal:USERS[0].id,created:t-86400000*30});
  }
  const stat=k=>{S.stats[k]=(S.stats[k]||0)+1};
  const regionOf=l=>REGION[normLoc(l)];
  const resId=r=>r.t==='group'?`/subscriptions/${r.sub}/resourceGroups/${r.name}`:`/subscriptions/${r.sub}/resourceGroups/${r.rg}/providers/${TYPES[r.t]}/${r.name}`;
  const inSub=r=>r.sub===curSub();
  const groups=()=>S.res.filter(r=>r.t==='group'&&inSub(r));
  const findGroup=n=>groups().find(g=>lc(g.name)===lc(n));
  const resOf=(t,rg)=>S.res.filter(r=>r.t===t&&inSub(r)&&(rg==null||lc(r.rg)===lc(rg)));
  const findRes=(t,rg,n)=>resOf(t,rg).find(r=>lc(r.name)===lc(n));
  const add=r=>{r.created=r.created||now();r.tags=r.tags||{};r.p=r.p||{};r.sub=r.sub||curSub();S.res.push(r);return r};
  const del=r=>{S.res=S.res.filter(x=>x!==r)};
  function needGroup(n,forWrite){
    const g=findGroup(n);
    if(!g)arm('ResourceGroupNotFound',`Resource group '${n}' could not be found.`,3);
    if(forWrite&&g.busy&&g.busy.state==='Deleting')arm('ResourceGroupBeingDeleted',`The resource group '${g.name}' is in deprovisioning state and cannot perform this operation.`);
    return g;
  }
  function needRes(t,rg,n){
    needGroup(rg);
    const r=findRes(t,rg,n);
    if(!r)arm('ResourceNotFound',`The Resource '${TYPES[t]}/${n}' under resource group '${rg}' was not found. For more details please go to https://aka.ms/ARMResourceNotFoundFix`,3);
    return r;
  }
  function needLoc(l,t){
    const r=regionOf(l);
    if(!r){
      const all=REGIONS.map(x=>x[0]).sort().join(',');
      if(t==='group')arm('LocationNotAvailableForResourceGroup',`The provided location '${l}' is not available for resource group. List of available regions is '${all}'.`);
      arm('LocationNotAvailableForResourceType',`The provided location '${l}' is not available for resource type '${TYPES[t]}'. List of available regions for the resource type is '${all}'.`);
    }
    return r.name;
  }
  const tagsOf=list=>Object.fromEntries((list||[]).filter(Boolean).map(t=>{const i=t.indexOf('=');return i<0?[t,'']:[t.slice(0,i),t.slice(i+1)]}));
  const busy=r=>r.busy&&r.busy.until>now()?r.busy.state:null;
  function settle(){
    const t=now();
    for(const r of S.res.slice())if(r.busy&&r.busy.until<=t){if(r.busy.state==='Deleting'){removeTree(r)}else delete r.busy}
  }
  function removeTree(r){
    if(r.t==='group'){for(const x of S.res.filter(x=>x.sub===r.sub&&lc(x.rg)===lc(r.name)))removeRes(x);S.roles=S.roles.filter(a=>!lc(a.scope).startsWith(lc(resId(r))));del(r);return}
    removeRes(r);
  }
  function removeRes(x){
    if(x.t==='aks'){S.gone.push({name:x.name,fqdn:x.p.fqdn,id:x.p.uid});S.gone=S.gone.slice(-20);const mc=S.res.find(g=>g.t==='group'&&g.p.managedBy===resId(x));if(mc)removeTree(mc)}
    if(x.t==='plan')for(const w of S.res.filter(w=>w.t==='webapp'&&w.p.plan===resId(x)))del(w);
    del(x);
  }

  // ---------- Formatos de salida ----------
  const cap=k=>k.charAt(0).toUpperCase()+k.slice(1);
  const cell=v=>v===null||v===undefined?'':v===true?'True':v===false?'False':typeof v==='object'?'':String(v);
  function table(rows){
    if(!rows.length)return'';
    const cols=[...new Set(rows.flatMap(r=>Object.keys(r)))].filter(k=>rows.some(r=>r[k]===null||typeof r[k]!=='object'));
    if(!cols.length)return'';
    const w=cols.map(c=>Math.max(cap(c).length,...rows.map(r=>cell(r[c]).length)));
    const line=a=>a.map((x,i)=>i===a.length-1?x:pad(x,w[i])).join('  ').replace(/\s+$/,'');
    return[line(cols.map(cap)),line(w.map(n=>'-'.repeat(n))),...rows.map(r=>line(cols.map(c=>cell(r[c]))))].join('\n');
  }
  function toRows(d){
    if(Array.isArray(d))return d.map(x=>x!==null&&typeof x==='object'&&!Array.isArray(x)?x:{Result:x});
    if(d!==null&&typeof d==='object')return[d];
    return[{Result:d}];
  }
  function tsv(d){
    const row=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)?Object.values(x).filter(v=>v===null||typeof v!=='object').map(v=>v===null?'':String(v)).join('\t'):Array.isArray(x)?x.map(v=>v===null||typeof v==='object'?'':String(v)).join('\t'):x===null?'':String(x);
    return Array.isArray(d)?d.map(row).join('\n'):row(d);
  }
  function format(res,G){
    let d=res.data;
    if(d===undefined)return'';
    if(G.query){
      try{d=JP.search(d,G.query)}catch(e){err(`argument --query: invalid jmespath_type value: '${G.query}'`,2)}
      stat('query');
    }
    const o=G.output||S.defaults.output||'json';
    if(o==='none')return'';
    if(o==='table'){stat('table');if(d===null||d===undefined)return'';return table(res.table&&!G.query?toRows(res.table(d)):toRows(d))}
    if(o==='tsv')return d===null||d===undefined?'':tsv(d);
    if(o==='yaml'||o==='yamlc')return d===null?'null':yaml.dump(d,{lineWidth:-1,noRefs:true}).replace(/\n$/,'');
    return JSON.stringify(d,null,2);
  }

  // ---------- Parser de argumentos (estilo argparse) ----------
  const isOpt=t=>/^-/.test(t)&&t!=='-'&&!/^-\d/.test(t);
  function usage(key,msg){
    const c=C[key];
    const ex=c&&c.ex&&c.ex[0];
    const path=key.split(' ');
    err(`${msg}${ex?`\n\nExamples from AI knowledge base:\n${ex[1]}\n${ex[0]}\n\nhttps://learn.microsoft.com/en-us/cli/azure/${path.slice(0,-1).join('/')||path[0]}#az-${key.replace(/ /g,'-')}\nRead more about the command in reference docs`:''}`,2);
  }
  function parseArgs(key,toks){
    const spec=[...C[key].args,...GLOBAL];
    const byOpt={};for(const a of spec)for(const o of a.opts)byOpt[o]=a;
    const v={},unknown=[];
    if(toks.includes('--help')||toks.includes('-h'))return{v:{help:true},unknown};
    for(let i=0;i<toks.length;i++){
      let t=toks[i],val=null;
      if(!isOpt(t)){if(C[key].positional)(v.__pos=v.__pos||[]).push(t);else unknown.push(t);continue}
      const eq=t.indexOf('=');
      if(t.startsWith('--')&&eq>0){val=t.slice(eq+1);t=t.slice(0,eq)}
      else if(!t.startsWith('--')&&t.length>2){val=t.slice(2).replace(/^=/,'');t=t.slice(0,2)}
      const a=byOpt[t];
      if(!a){unknown.push(toks[i]);while(i+1<toks.length&&!isOpt(toks[i+1]))unknown.push(toks[++i]);continue}
      const nm=a.opts.join('/');
      if(a.type==='bool'){if(val!=null)usage(key,`argument ${nm}: ignored explicit argument '${val}'`);v[a.dest]=true;continue}
      if(a.type==='tbool'){if(val==null&&i+1<toks.length&&/^(true|false)$/i.test(toks[i+1]))val=toks[++i];if(val!=null&&!/^(true|false)$/i.test(val))usage(key,`argument ${nm}: invalid choice: '${val}' (choose from 'false', 'true')`);v[a.dest]=val==null||/^true$/i.test(val);continue}
      if(a.type==='list'){const vals=val!=null?[val]:[];while(i+1<toks.length&&!isOpt(toks[i+1]))vals.push(toks[++i]);if(!vals.length&&!a.empty)usage(key,`argument ${nm}: expected at least one argument`);v[a.dest]=vals;continue}
      if(val==null){if(i+1>=toks.length||isOpt(toks[i+1]))usage(key,`argument ${nm}: expected one argument`);val=toks[++i]}
      if(a.choices){const c=a.choices.find(c=>c.toLowerCase()===val.toLowerCase());if(!c)usage(key,`argument ${nm}: invalid choice: '${val}' (choose from ${a.choices.map(c=>`'${c}'`).join(', ')})`);val=c}
      if(a.type==='int'){if(!/^-?\d+$/.test(val))usage(key,`argument ${nm}: invalid int value: '${val}'`);val=+val}
      v[a.dest]=val;
    }
    for(const a of C[key].args)if(v[a.dest]==null&&a.cfg&&S.defaults[a.cfg])v[a.dest]=S.defaults[a.cfg];
    const missing=C[key].args.filter(a=>a.req&&(v[a.dest]==null||v[a.dest]===''));
    if(missing.length)usage(key,`the following arguments are required: ${missing.map(a=>a.opts.join('/')).join(', ')}`);
    if(unknown.length)usage(key,`unrecognized arguments: ${unknown.join(' ')}`);
    return{v,unknown};
  }

  // ---------- Ayuda ----------
  function children(prefix){
    const lvl=prefix?prefix.split(' ').length+1:1;
    const subs=Object.keys(GROUPS).filter(g=>g&&g.split(' ').length===lvl&&(!prefix||g.startsWith(prefix+' ')));
    const cmds=Object.keys(C).filter(k=>k.split(' ').length===lvl&&(!prefix||k.startsWith(prefix+' ')));
    return{subs,cmds};
  }
  const last=k=>k.split(' ').pop();
  function groupHelp(prefix){
    const{subs,cmds}=children(prefix);
    const w=Math.max(15,...[...subs,...cmds].map(k=>last(k).length));
    const row=(k,d)=>`    ${pad(last(k),w)} : ${d}`;
    if(!prefix)return`\nGroup\n    az\n\nSubgroups:\n${subs.map(k=>row(k,GROUPS[k])).join('\n')}\n\nCommands:\n${cmds.map(k=>row(k,C[k].desc)).join('\n')}\n\nTo search AI knowledge base for examples, use: az find "az"\n\ncloudlab: se muestran los grupos simulados. Azure CLI real tiene más de 100.`;
    return`\nGroup\n    az ${prefix} : ${GROUPS[prefix]}\n${subs.length?`\nSubgroups:\n${subs.map(k=>row(k,GROUPS[k])).join('\n')}\n`:''}${cmds.length?`\nCommands:\n${cmds.map(k=>row(k,C[k].desc)).join('\n')}\n`:''}\nTo search AI knowledge base for examples, use: az find "az ${prefix}"\n`;
  }
  function cmdHelp(key){
    const c=C[key];
    const fmt=list=>{const w=Math.max(...list.map(a=>a.opts.join(' ').length+(a.req?11:0)),30);return list.map(a=>{const n=a.opts.join(' ');return`    ${pad(n+(a.req?' '.repeat(Math.max(1,w-n.length-10))+'[Required]':''),w)} : ${a.desc||''}${a.choices&&a.opts[0]!=='--output'?`  Allowed values: ${a.choices.join(', ')}.`:''}${a.def!=null?`  Default: ${a.def}.`:''}`}).join('\n')};
    const args=c.args.slice().sort((a,b)=>(b.req?1:0)-(a.req?1:0)||a.opts[0].localeCompare(b.opts[0]));
    return`\nCommand\n    az ${key} : ${c.desc}\n${c.long?`        ${c.long}\n`:''}${args.length?`\nArguments\n${fmt(args)}\n`:''}\nGlobal Arguments\n${fmt(GLOBAL)}\n${c.ex&&c.ex.length?`\nExamples\n${c.ex.map(([d,x])=>`    ${d}\n        ${x}\n`).join('\n')}`:''}\nTo search AI knowledge base for examples, use: az find "az ${key}"\n`;
  }
  function welcome(){
    const{subs,cmds}=children('');
    const items=[...subs.map(k=>[k,GROUPS[k]]),...cmds.map(k=>[k,C[k].desc])].sort((a,b)=>a[0].localeCompare(b[0]));
    return`\n     /\\\n    /  \\    _____   _ _  ___ _\n   / /\\ \\  |_  / | | | \\'__/ _ \\\n  / ____ \\  / /| |_| | | |  __/\n /_/    \\_\\/___|\\__,_|_|  \\___|\n\n\nWelcome to the cool new Azure CLI!\n\nUse \`az --version\` to display the current version.\nHere are the base commands:\n\n${items.map(([k,d])=>`    ${pad(k,18)}: ${d.length>70?d.slice(0,67)+'...':d}`).join('\n')}\n`;
  }

  // ---------- Intérprete de az ----------
  function az(args){
    if(!args.length)return{text:welcome()};
    if(args[0]==='--version'||args[0]==='-v')return{text:versionText()};
    if(args[0]==='--help'||args[0]==='-h')return{text:groupHelp('')};
    let prefix='',i=0;
    while(i<args.length&&!isOpt(args[i])){
      const cand=prefix?`${prefix} ${args[i]}`:args[i];
      if(C[cand]){return runCmd(cand,args.slice(i+1))}
      if(GROUPS[cand]!=null){prefix=cand;i++;continue}
      const w=args[i];
      const real=(REAL[prefix]||[]).includes(w);
      if(real)return{text:`cloudlab: "az ${cand}" existe en Azure CLI ${CLI_VERSION}, pero todavía no se simula aquí.\nEscribe "az ${prefix?prefix+' ':''}--help" para ver los comandos disponibles.`};
      const opts=[...children(prefix).subs.map(last),...children(prefix).cmds.map(last),...(REAL[prefix]||[])];
      const s=similar(w,[...new Set(opts)]);
      fail(`${prefix?'az '+prefix:'az'}: '${w}' is not in the '${prefix?'az '+prefix:'az'}' command group. See '${prefix?'az '+prefix:'az'} --help'.${prefix?'':' If the command is from an extension, please make sure the corresponding extension is installed. To learn more about extensions, please visit https://learn.microsoft.com/en-us/cli/azure/azure-cli-extensions-overview'}${s.length?`\n\nThe most similar choice${s.length>1?'s':''} to '${w}' ${s.length>1?'are':'is'}:\n${s.map(x=>'\t'+x).join('\n')}`:''}`,2);
    }
    return{text:groupHelp(prefix)};
  }
  function runCmd(key,toks){
    const c=C[key];
    const{v}=parseArgs(key,toks);
    if(v.help)return{text:cmdHelp(key)};
    if(v.subscription){
      const s=S.subs.find(s=>s.id===v.subscription||lc(s.name)===lc(v.subscription));
      if(S.loggedIn&&!s)err(`The subscription of '${v.subscription}' doesn't exist in cloud 'AzureCloud'.`);
      if(s)S.cur=s.id;
    }
    if(c.login!==false&&!S.loggedIn)err(`Please run 'az login' to setup account.`);
    settle();
    // Las preguntas (y/n, contraseña) conservan -o, --query y la tabla del comando al continuar.
    const wrap=e=>{const cont=e.cont;e.cont=a=>{try{const r=cont(a)||{};return{...r,table:r.table||c.table,G:v}}catch(x){throw x instanceof Ask?wrap(x):x}};return e};
    let r;
    try{r=c.fn(v)||{}}catch(e){throw e instanceof Ask?wrap(e):e}
    if(r.ask)wrap(r.ask);
    r.table=r.table||c.table;
    return{...r,G:v};
  }
  function versionText(){
    return`azure-cli                         ${CLI_VERSION}\n\ncore                              ${CLI_VERSION}\ntelemetry                          1.1.0\n\nDependencies:\nmsal                              1.34.0\nazure-mgmt-resource               24.0.0\n\nPython location '/usr/bin/python3.12'\nConfig directory '/home/user/.azure'\nExtensions directory '/home/user/.azure/cliextensions'\n\nPython (Linux) 3.12.11 (main, Sep  2 2026, 10:12:44) [GCC 13.3.0]\n\nLegal docs and information: aka.ms/AzureCliLegal\n\n\nYour CLI is up-to-date.`;
  }
  const confirm=(cont,text='Are you sure you want to perform this operation? (y/n): ')=>{
    const handler=a=>{const x=lc(a.trim());if(x==='y'||x==='yes')return cont();if(x==='n'||x==='no')return{text:'Operation cancelled.'};throw new Ask(text,handler)};
    throw new Ask(text,handler);
  };

  // ---------- Vistas ARM (JSON como el que devuelve Azure) ----------
  const disp=l=>(REGION[l]||{display:l}).display;
  function groupView(g){return{id:resId(g),location:g.location,managedBy:g.p.managedBy||null,name:g.name,properties:{provisioningState:busy(g)||'Succeeded'},tags:Object.keys(g.tags).length?g.tags:null,type:TYPES.group}}
  const powerText=v=>busy(v)==='Creating'?'VM starting':busy(v)==='Deleting'?'VM deallocating':{running:'VM running',stopped:'VM stopped',deallocated:'VM deallocated'}[v.p.power];
  function vmView(v,details){
    const nic=S.res.find(n=>n.t==='nic'&&resId(n)===v.p.nic),pip=nic&&S.res.find(p=>p.t==='pip'&&resId(p)===nic.p.pip);
    const o={additionalCapabilities:null,applicationProfile:null,availabilitySet:null,billingProfile:null,capacityReservation:null,diagnosticsProfile:null,evictionPolicy:null,extendedLocation:null,extensionsTimeBudget:null,
      hardwareProfile:{vmSize:v.p.size,vmSizeProperties:null},host:null,hostGroup:null,id:resId(v),identity:null,instanceView:null,licenseType:null,location:v.location,name:v.name,
      networkProfile:{networkApiVersion:null,networkInterfaceConfigurations:null,networkInterfaces:[{deleteOption:null,id:v.p.nic,primary:null,resourceGroup:v.rg}]},
      osProfile:{adminPassword:null,adminUsername:v.p.admin,allowExtensionOperations:true,computerName:v.name,customData:null,linuxConfiguration:v.p.windows?null:{disablePasswordAuthentication:v.p.auth==='ssh',enableVmAgentPlatformUpdates:false,patchSettings:{assessmentMode:'ImageDefault',automaticByPlatformSettings:null,patchMode:'ImageDefault'},provisionVmAgent:true,ssh:v.p.auth==='ssh'?{publicKeys:[{keyData:'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQ... generated-by-azure',path:`/home/${v.p.admin}/.ssh/authorized_keys`}]}:null},requireGuestProvisionSignal:true,secrets:[],windowsConfiguration:v.p.windows?{enableAutomaticUpdates:true,provisionVmAgent:true,timeZone:null}:null},
      plan:null,platformFaultDomain:null,priority:null,provisioningState:busy(v)||'Succeeded',proximityPlacementGroup:null,resourceGroup:v.rg,resources:null,scheduledEventsPolicy:null,scheduledEventsProfile:null,
      securityProfile:{encryptionAtHost:null,securityType:'TrustedLaunch',uefiSettings:{secureBootEnabled:true,vTpmEnabled:true}},
      storageProfile:{dataDisks:[],diskControllerType:'SCSI',imageReference:(([pub,offer,sku,ver])=>({communityGalleryImageId:null,exactVersion:'1.0.0',id:null,offer,publisher:pub,sharedGalleryImageId:null,sku,version:ver}))(v.p.urn.split(':')),
        osDisk:{caching:'ReadWrite',createOption:'FromImage',deleteOption:'Detach',diffDiskSettings:null,diskSizeGb:v.p.windows?127:30,encryptionSettings:null,image:null,managedDisk:{diskEncryptionSet:null,id:v.p.disk,resourceGroup:v.rg,securityProfile:null,storageAccountType:'Premium_LRS'},name:v.p.disk.split('/').pop(),osType:v.p.windows?'Windows':'Linux',vhd:null,writeAcceleratorEnabled:null}},
      tags:Object.keys(v.tags).length?v.tags:{},timeCreated:iso(v.created),type:TYPES.vm,userData:null,virtualMachineScaleSet:null,vmId:v.p.vmId,zones:v.p.zone?[v.p.zone]:null};
    if(details)Object.assign(o,{fqdns:'',macAddresses:nic?nic.p.mac:'',powerState:powerText(v),privateIps:nic?nic.p.ip:'',publicIps:pip&&v.p.power!=='deallocated'?pip.p.ip:''});
    return o;
  }
  const vmTable=d=>d.map(v=>({Name:v.name,ResourceGroup:v.resourceGroup,...(v.powerState!==undefined?{PowerState:v.powerState,PublicIps:v.publicIps,Fqdns:v.fqdns}:{}),Location:v.location,Zones:(v.zones||[]).join(',')}));
  function storageView(s){
    const r=REGION[s.location],geo=/GRS|GZRS/.test(s.p.sku),ep=k=>`https://${s.name}.${k}.core.windows.net/`;
    return{accessTier:s.p.kind==='StorageV2'||s.p.kind==='BlobStorage'?s.p.tier:null,allowBlobPublicAccess:false,allowCrossTenantReplication:false,allowSharedKeyAccess:null,azureFilesIdentityBasedAuthentication:null,creationTime:iso(s.created),customDomain:null,defaultToOAuthAuthentication:null,dnsEndpointType:null,enableHttpsTrafficOnly:s.p.https,
      encryption:{encryptionIdentity:null,keySource:'Microsoft.Storage',keyVaultProperties:null,requireInfrastructureEncryption:null,services:{blob:{enabled:true,keyType:'Account',lastEnabledTime:iso(s.created)},file:{enabled:true,keyType:'Account',lastEnabledTime:iso(s.created)},queue:null,table:null}},
      extendedLocation:null,failoverInProgress:null,geoReplicationStats:null,id:resId(s),identity:null,immutableStorageWithVersioning:null,isHnsEnabled:null,isLocalUserEnabled:null,isSftpEnabled:null,keyCreationTime:{key1:iso(s.created),key2:iso(s.created)},keyPolicy:null,kind:s.p.kind,largeFileSharesState:null,lastGeoFailoverTime:null,location:s.location,minimumTlsVersion:'TLS1_2',name:s.name,networkRuleSet:{bypass:'AzureServices',defaultAction:'Allow',ipRules:[],ipv6Rules:[],resourceAccessRules:null,virtualNetworkRules:[]},
      primaryEndpoints:{blob:ep('blob'),dfs:ep('dfs'),file:ep('file'),internetEndpoints:null,microsoftEndpoints:null,queue:ep('queue'),table:ep('table'),web:`https://${s.name}.z${(s.name.length%40)+1}.web.core.windows.net/`},primaryLocation:s.location,privateEndpointConnections:[],provisioningState:busy(s)||'Succeeded',publicNetworkAccess:null,resourceGroup:s.rg,routingPreference:null,sasPolicy:null,
      secondaryEndpoints:s.p.sku.startsWith('Standard_RA')?{blob:`https://${s.name}-secondary.blob.core.windows.net/`,dfs:`https://${s.name}-secondary.dfs.core.windows.net/`,file:null,internetEndpoints:null,microsoftEndpoints:null,queue:`https://${s.name}-secondary.queue.core.windows.net/`,table:`https://${s.name}-secondary.table.core.windows.net/`,web:`https://${s.name}-secondary.z${(s.name.length%40)+1}.web.core.windows.net/`}:null,
      secondaryLocation:geo&&r?r.pair:null,sku:{name:s.p.sku,tier:s.p.sku.startsWith('Premium')?'Premium':'Standard'},statusOfPrimary:'available',statusOfSecondary:geo&&r&&r.pair?'available':null,storageAccountSkuConversionStatus:null,tags:s.tags,type:TYPES.storage};
  }
  function subnetView(v,sn){
    const vid=resId(v),nics=S.res.filter(n=>n.t==='nic'&&n.p.subnet===`${vid}/subnets/${sn.name}`);
    return{addressPrefix:sn.prefix,applicationGatewayIPConfigurations:null,delegations:[],etag:`W/"${sn.etag}"`,id:`${vid}/subnets/${sn.name}`,ipConfigurations:nics.length?nics.map(n=>({id:`${resId(n)}/ipConfigurations/ipconfig${n.p.vm}`,resourceGroup:n.rg})):null,name:sn.name,networkSecurityGroup:null,privateEndpointNetworkPolicies:'Disabled',privateLinkServiceNetworkPolicies:'Enabled',provisioningState:'Succeeded',resourceGroup:v.rg,routeTable:null,serviceEndpoints:null,type:'Microsoft.Network/virtualNetworks/subnets'};
  }
  function vnetView(v){return{addressSpace:{addressPrefixes:v.p.prefixes},bgpCommunities:null,ddosProtectionPlan:null,dhcpOptions:{dnsServers:[]},enableDdosProtection:false,enableVmProtection:null,encryption:null,etag:`W/"${v.p.etag}"`,extendedLocation:null,flowTimeoutInMinutes:null,id:resId(v),ipAllocations:null,location:v.location,name:v.name,provisioningState:'Succeeded',resourceGroup:v.rg,resourceGuid:v.p.guid,subnets:v.p.subnets.map(sn=>subnetView(v,sn)),tags:v.tags,type:TYPES.vnet,virtualNetworkPeerings:[]}}
  const SKU_TIER=s=>s==='F1'||s==='FREE'?['Free','F']:s==='D1'||s==='SHARED'?['Shared','D']:s[0]==='B'?['Basic','B']:s[0]==='S'?['Standard','S']:/^P\d+MV3$/.test(s)?['PremiumMV3','Pmv3']:/V4$/.test(s)?['PremiumV4','Pv4']:/V3$/.test(s)?['PremiumV3','Pv3']:/V2$/.test(s)&&s[0]==='P'?['PremiumV2','Pv2']:s[0]==='I'?['IsolatedV2','Iv2']:['WorkflowStandard','WS'];
  function planView(p){
    const[tier,family]=SKU_TIER(p.p.sku),name=p.p.sku==='FREE'?'F1':p.p.sku==='SHARED'?'D1':p.p.sku;
    return{elasticScaleEnabled:false,extendedLocation:null,freeOfferExpirationTime:null,geoRegion:disp(p.location),hostingEnvironmentProfile:null,hyperV:false,id:resId(p),isSpot:false,isXenon:false,kind:p.p.linux?'linux':'app',kubeEnvironmentProfile:null,location:disp(p.location),maximumElasticWorkerCount:1,maximumNumberOfWorkers:{Free:1,Shared:1,Basic:3,Standard:10}[tier]||30,name:p.name,numberOfSites:S.res.filter(w=>w.t==='webapp'&&w.p.plan===resId(p)).length,numberOfWorkers:p.p.workers,perSiteScaling:false,provisioningState:'Succeeded',reserved:p.p.linux,resourceGroup:p.rg,sku:{capacity:p.p.workers,family,name,size:name,skuCapacity:null,tier},spotExpirationTime:null,status:'Ready',tags:Object.keys(p.tags).length?p.tags:null,targetWorkerCount:0,targetWorkerSizeId:0,type:'Microsoft.Web/serverfarms',workerTierName:null,zoneRedundant:false};
  }
  function siteView(w){
    const host=`${w.name}.azurewebsites.net`;
    return{availabilityState:'Normal',clientAffinityEnabled:true,clientCertEnabled:false,containerSize:0,dailyMemoryTimeQuota:0,defaultHostName:host,enabled:true,enabledHostNames:[host,`${w.name}.scm.azurewebsites.net`],ftpPublishingUrl:`ftps://waws-prod-${w.location.slice(0,3)}-0${w.name.length%9+1}.ftp.azurewebsites.windows.net/site/wwwroot`,hostNames:[host],hostNamesDisabled:false,httpsOnly:false,id:resId(w),identity:null,kind:w.p.linux?'app,linux':'app',lastModifiedTimeUtc:iso(w.created),location:disp(w.location),name:w.name,outboundIpAddresses:w.p.ips.join(','),possibleOutboundIpAddresses:w.p.ips.join(','),publicNetworkAccess:null,repositorySiteName:w.name,reserved:w.p.linux,resourceGroup:w.rg,scmSiteAlsoStopped:false,serverFarmId:w.p.plan,siteConfig:{alwaysOn:false,linuxFxVersion:w.p.linux?w.p.runtime.replace(':','|'):'',netFrameworkVersion:w.p.linux?null:'v4.0',numberOfWorkers:1,windowsFxVersion:null},state:w.p.state,tags:Object.keys(w.tags).length?w.tags:null,type:TYPES.webapp,usageState:'Normal'};
  }
  const siteTable=d=>d.map(w=>({Name:w.name,Location:w.location,State:w.state,ResourceGroup:w.resourceGroup,DefaultHostName:w.defaultHostName,AppServicePlan:(w.serverFarmId||'').split('/').pop()}));
  function aksView(a){
    const st=busy(a);
    return{aadProfile:null,addonProfiles:null,agentPoolProfiles:[{availabilityZones:null,count:a.p.count,currentOrchestratorVersion:a.p.version,enableAutoScaling:false,enableNodePublicIp:false,kubeletDiskType:'OS',maxPods:250,mode:'System',name:'nodepool1',nodeImageVersion:'AKSUbuntu-2204gen2containerd-202609.15.0',orchestratorVersion:a.p.version,osDiskSizeGb:128,osDiskType:'Managed',osSku:'Ubuntu',osType:'Linux',powerState:{code:a.p.power},provisioningState:st||'Succeeded',type:'VirtualMachineScaleSets',vmSize:a.p.vmSize}],
      apiServerAccessProfile:null,autoUpgradeProfile:{nodeOsUpgradeChannel:'NodeImage',upgradeChannel:null},azurePortalFqdn:a.p.fqdn.replace('.hcp.','.portal.hcp.'),currentKubernetesVersion:a.p.version,disableLocalAccounts:false,dnsPrefix:a.p.dnsPrefix,enableRbac:true,fqdn:a.p.fqdn,id:resId(a),identity:{principalId:a.p.principal,tenantId:S.tenant.id,type:'SystemAssigned',userAssignedIdentities:null},kubernetesVersion:a.p.version,location:a.location,maxAgentPools:100,name:a.name,
      networkProfile:{dnsServiceIp:'10.0.0.10',ipFamilies:['IPv4'],loadBalancerSku:'standard',networkDataplane:'azure',networkPlugin:'azure',networkPluginMode:'overlay',networkPolicy:'none',outboundType:'loadBalancer',podCidr:'10.244.0.0/16',podCidrs:['10.244.0.0/16'],serviceCidr:'10.0.0.0/16',serviceCidrs:['10.0.0.0/16']},
      nodeResourceGroup:a.p.nodeRg,oidcIssuerProfile:{enabled:false,issuerUrl:null},powerState:{code:a.p.power},provisioningState:st||'Succeeded',resourceGroup:a.rg,servicePrincipalProfile:{clientId:'msi',secret:null},sku:{name:'Base',tier:a.p.tier},supportPlan:'KubernetesOfficial',tags:Object.keys(a.tags).length?a.tags:null,type:'Microsoft.ContainerService/ManagedClusters'};
  }
  const aksTable=d=>d.map(a=>({Name:a.name,Location:a.location,ResourceGroup:a.resourceGroup,KubernetesVersion:a.kubernetesVersion,CurrentKubernetesVersion:a.currentKubernetesVersion,ProvisioningState:a.provisioningState,Fqdn:a.fqdn}));
  const userOf=id=>USERS.find(u=>u.id===id);
  function roleView(r){
    const u=userOf(r.principal),m=r.scope.match(/resourceGroups\/([^/]+)/i);
    return{condition:null,conditionVersion:null,createdBy:USERS[0].id,createdOn:iso(r.created),delegatedManagedIdentityResourceId:null,description:null,id:`${r.scope}/providers/Microsoft.Authorization/roleAssignments/${r.id}`,name:r.id,principalId:r.principal,principalName:u?u.upn:'',principalType:'User',resourceGroup:m?m[1]:undefined,roleDefinitionId:`/subscriptions/${r.scope.split('/')[2]}/providers/Microsoft.Authorization/roleDefinitions/${ROLES[r.role]}`,roleDefinitionName:r.role,scope:r.scope,type:'Microsoft.Authorization/roleAssignments',updatedBy:USERS[0].id,updatedOn:iso(r.created)};
  }
  function genericView(r){return{changedTime:iso(r.created),createdTime:iso(r.created),extendedLocation:null,id:resId(r),identity:null,kind:r.t==='storage'?r.p.kind:r.t==='webapp'?(r.p.linux?'app,linux':'app'):r.t==='plan'?(r.p.linux?'linux':'app'):null,location:r.location,managedBy:null,name:r.name,plan:null,properties:null,provisioningState:busy(r)||'Succeeded',resourceGroup:r.rg,sku:null,tags:Object.keys(r.tags).length?r.tags:null,type:TYPES[r.t]}}

  // ---------- Cuotas de vCPU (por suscripción y región) ----------
  function coreUsage(loc){
    const fam={};let total=0,vms=0;
    for(const v of S.res.filter(v=>v.t==='vm'&&inSub(v)&&v.location===loc)){vms++;if(v.p.power==='deallocated')continue;const[c,,f]=SIZES[v.p.size];total+=c;fam[f]=(fam[f]||0)+c}
    for(const a of S.res.filter(a=>a.t==='aks'&&inSub(a)&&a.location===loc&&a.p.power==='Running')){const[c,,f]=SIZES[a.p.vmSize];total+=c*a.p.count;fam[f]=(fam[f]||0)+c*a.p.count}
    return{total,fam,vms};
  }
  function checkQuota(loc,size,count=1){
    const[c,,f]=SIZES[size],u=coreUsage(loc),need=c*count;
    const famUse=u.fam[f]||0,famLim=FAMILY_LIMIT(f);
    const q=(what,lim,cur)=>arm('QuotaExceeded',`Operation could not be completed as it results in exceeding approved ${what} quota. Additional details - Deployment Model: Resource Manager, Location: ${loc}, Current Limit: ${lim}, Current Usage: ${cur}, Additional Required: ${need}, (Minimum) New Limit Required: ${cur+need}. Setup Alerts when Quota reaches threshold. Learn more at https://aka.ms/quotamonitoringalerting . Submit a request for Quota increase at https://aka.ms/ProdportalCRP/#blade/Microsoft_Azure_Capacity/UsageAndQuota.ReactView/Parameters/%7B%22subscriptionId%22:%22${curSub()}%22,%22command%22:%22openQuotaApprovalBlade%22%7D by specifying parameters listed in the ‘Details’ section for deployment to succeed. Please read more about quota limits at https://docs.microsoft.com/en-us/azure/azure-supportability/regional-quota-requests\ncloudlab: la cuota de vCPU por región es ${QUOTA}. Las VM desasignadas (az vm deallocate) y los AKS detenidos no consumen cuota.`);
    if(famUse+need>famLim)q(`${f} Cores`,famLim,famUse);
    if(u.total+need>QUOTA)q('Total Regional Cores',QUOTA,u.total);
  }

  // ---------- Comandos: cuenta ----------
  function accountView(s){return{environmentName:'AzureCloud',homeTenantId:S.tenant.id,id:s.id,isDefault:s.id===S.current,managedByTenants:[],name:s.name,state:'Enabled',tenantDefaultDomain:S.tenant.domain,tenantDisplayName:S.tenant.name,tenantId:S.tenant.id,user:{name:USERS[0].upn,type:'user'}}}
  const accTable=d=>d.map(a=>({Name:a.name,CloudName:'AzureCloud',SubscriptionId:a.id,TenantId:a.tenantId,State:a.state,IsDefault:a.isDefault}));
  function loginFlow(prefix){
    const rows=S.subs.map((s,i)=>[`[${i+1}]${s.id===S.current?' *':''}`,s.name,s.id,S.tenant.name]);
    const w=[0,1,2,3].map(i=>Math.max(...rows.map(r=>r[i].length),['No','Subscription name','Subscription ID','Tenant'][i].length));
    const line=a=>a.map((x,i)=>i===3?x:pad(x,w[i])).join('  ');
    const tbl=[line(['No','Subscription name','Subscription ID','Tenant']),line(w.map(n=>'-'.repeat(n))),...rows.map(line)].join('\n');
    const def=sub();
    const text=`${prefix}\n\nRetrieving tenants and subscriptions for the selection...\n\n[Tenant and subscription selection]\n\n${tbl}\n\nThe default is marked with an *; the default tenant is '${S.tenant.name}' and subscription is '${def.name}' (${def.id}).\n`;
    const ask='Select a subscription and tenant (Type a number or Enter for no changes): ';
    const handler=a=>{
      const x=a.trim();
      if(x&&!(/^\d+$/.test(x)&&+x>=1&&+x<=S.subs.length))throw new Ask(`Invalid selection.\n${ask}`,handler);
      if(x)S.current=S.subs[+x-1].id;
      S.loggedIn=true;S.cur=null;stat('login');
      const s=sub();
      return{text:`\nTenant: ${S.tenant.name}\nSubscription: ${s.name} (${s.id})\n\n[Announcements]\nWith the new Azure CLI login experience, you can select the subscription you want to use more easily. Learn more about it and its configuration at https://go.microsoft.com/fwlink/?linkid=2271236\n\nIf you encounter any problem, please open an issue at https://aka.ms/azclibug\n\n[Warning] The login output has been updated. Please be aware that it no longer displays the full list of available subscriptions by default.\n`};
    };
    return{pre:text,ask:new Ask(ask,handler)};
  }
  cmd('login','Log in to Azure.',[A('device',['--use-device-code'],{type:'bool',desc:'Use CLI\'s old authentication flow based on device code.'}),A('tenant',['--tenant','-t'],{desc:'The Microsoft Entra tenant, must be provided when using a service principal.'}),A('username',['--username','-u'],{desc:'User name, service principal client ID, or managed identity ID.'}),A('password',['--password','-p'],{desc:'User password or service principal secret.'}),A('sp',['--service-principal'],{type:'bool',desc:'Log in with a service principal.'}),A('identity',['--identity'],{type:'bool',desc:'Log in using managed identity.'}),A('noSubs',['--allow-no-subscriptions'],{type:'bool',desc:'Support access tenants without subscriptions.'})],
    [['Log in interactively.','az login'],['Log in with device code.','az login --use-device-code']],v=>{
      if(v.sp||v.identity||v.password)return{text:`cloudlab: en este simulador solo está disponible el inicio de sesión interactivo (az login o az login --use-device-code).\nEn Azure real, --service-principal y --identity sirven para automatización (pipelines, VMs con identidad administrada).`};
      const code=Array.from({length:9},()=>'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.random()*32|0]).join('');
      const pre=v.device?`To sign in, use a web browser to open the page https://login.microsoft.com/device and enter the code ${code} to authenticate.\ncloudlab: inicio de sesión simulado; no tienes que abrir nada.`:`A web browser has been opened at https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize. Please continue the login in the web browser. If no web browser is available or if the web browser fails to open, use device code flow with \`az login --use-device-code\`.\ncloudlab: inicio de sesión simulado como ${USERS[0].upn}; no se abre ningún navegador.`;
      const f=loginFlow(pre);
      return{text:f.pre,ask:f.ask};
    },{login:false});
  cmd('logout','Log out to remove access to Azure subscriptions.',[A('username',['--username'],{desc:'Account user, if missing, logout the current active account.'})],[['Log out the active user.','az logout']],()=>{if(!S.loggedIn)err(`There are no active accounts.`);S.loggedIn=false;return{}},{login:false});
  cmd('account show','Get the details of a subscription.',[A('name',['--name','--subscription','-n','-s'],{desc:'Name or ID of subscription.'})],[['Get the details of the current subscription.','az account show']],v=>{
    const s=v.name?S.subs.find(s=>s.id===v.name||lc(s.name)===lc(v.name)):S.subs.find(s=>s.id===curSub());
    if(!s)err(`Subscription '${v.name}' not found. Check the spelling and casing and try again.`);
    return{data:accountView(s)};
  });
  cmd('account list','Get a list of subscriptions for the logged in account. By default, only \'Enabled\' subscriptions from the current cloud is shown.',[A('all',['--all'],{type:'bool',desc:'List all subscriptions from all clouds, rather than just \'Enabled\' ones.'}),A('refresh',['--refresh'],{type:'bool',desc:'Retrieve up-to-date subscriptions from server.'})],[['Get a list of subscriptions for the logged in account.','az account list -o table']],()=>({data:S.subs.map(accountView)}),{table:accTable});
  cmd('account set','Set a subscription to be the current active subscription.',[A('name',['--name','--subscription','-n','-s'],{req:true,desc:'Name or ID of subscription.'})],[['Set the current active subscription.','az account set --subscription "Cloud Lab Dev"']],v=>{
    const s=S.subs.find(s=>s.id===v.name||lc(s.name)===lc(v.name));
    if(!s)err(`The subscription of '${v.name}' doesn't exist in cloud 'AzureCloud'.`);
    S.current=s.id;S.cur=null;stat('accountSet');return{};
  });
  cmd('account list-locations','List supported regions for the current subscription.',[A('includeExt',['--include-extended-locations'],{type:'tbool',desc:'Whether to include extended locations.'})],[['List supported regions for the current subscription.','az account list-locations -o table']],()=>({data:REGIONS.map(([n,d,g,pr])=>({availabilityZoneMappings:REGION[n].zones?[1,2,3].map(z=>({logicalZone:String(z),physicalZone:`${n}-az${(z%3)+1}`})):null,displayName:d,id:`/subscriptions/${curSub()}/locations/${n}`,metadata:{geography:g==='US'?'United States':g,geographyGroup:g==='US'||g==='Canada'||g==='Mexico'?'US':g==='South America'||g==='Chile'?'South America':g==='UK'?'Europe':g==='New Zealand'?'Asia Pacific':g,latitude:null,longitude:null,pairedRegion:pr?[{id:`/subscriptions/${curSub()}/locations/${pr}`,name:pr}]:[],physicalLocation:null,regionCategory:'Recommended',regionType:'Physical'},name:n,regionalDisplayName:`(${g}) ${d}`,type:'Region'}))}),{table:d=>d.map(l=>({DisplayName:l.displayName,Name:l.name,RegionalDisplayName:l.regionalDisplayName}))});
  cmd('configure','Manage Azure CLI configuration. This command is interactive.',[A('defaults',['--defaults','-d'],{type:'list',desc:'Space-separated \'name=value\' pairs for common argument defaults. E.g. \'--defaults group=myRG web=myweb vm=myvm\'. Use \'\' to clear the defaults.'}),A('list',['--list-defaults','-l'],{type:'tbool',desc:'List all applicable defaults.'}),A('scope',['--scope'],{choices:['global','local'],desc:'Scope of defaults.'})],[['Set default resource group and location.','az configure --defaults group=myRG location=eastus'],['List the defaults.','az configure --list-defaults -o table']],v=>{
    if(v.list)return{data:Object.entries(S.defaults).filter(([k])=>k!=='output').map(([name,value])=>({name,source:'/home/user/.azure/config',value}))};
    if(v.defaults){for(const d of v.defaults){const i=d.indexOf('=');if(i<0)err(`usage error: --defaults NAME=VALUE`,2);const k=d.slice(0,i),val=d.slice(i+1);if(val)S.defaults[k]=val;else delete S.defaults[k]}return{}}
    return{text:`cloudlab: la configuración interactiva no está disponible. Usa az configure --defaults group=<grupo> location=<región>`};
  },{login:false});

  // ---------- Comandos: grupos de recursos ----------
  const groupTable=d=>d.map(g=>({Name:g.name,Location:g.location,Status:g.properties.provisioningState}));
  cmd('group create','Create a new resource group.',[A('name',['--name','--resource-group','-n','-g'],{req:true,desc:'Name of the new resource group.'}),A('location',['--location','-l'],{req:true,desc:'Location. Values from: `az account list-locations`. You can configure the default location using `az configure --defaults location=<location>`.',cfg:'location'}),A('managedBy',['--managed-by'],{desc:'The ID of the resource that manages this resource group.'}),TAGS],
    [['Create a new resource group in the West US region.','az group create -l westus -n MyResourceGroup']],v=>{
      const n=v.name;
      const bad=[...new Set(n.replace(/[-\w.()]/g,'').split(''))];
      if(bad.length||/\.$/.test(n)||n.length>90)arm('InvalidResourceGroup',`The provided resource group name '${n}' has these invalid characters: '${bad.join('')||'.'}'. The name can only be a letter, digit, '-', '.', '(', ')' or '_'. See https://aka.ms/ResourceGroupNamingRestrictions for more information.`);
      const loc=needLoc(v.location,'group');
      let g=findGroup(n);
      if(g&&busy(g)==='Deleting')arm('ResourceGroupBeingDeleted',`The resource group '${g.name}' is in deprovisioning state and cannot perform this operation.`);
      if(g&&g.location!==loc)arm('InvalidResourceGroupLocation',`Invalid resource group location '${loc}'. The Resource group already exists in location '${g.location}'.`);
      if(!g)g=add({t:'group',name:n,location:loc});
      if(v.tags)g.tags=tagsOf(v.tags);
      return{data:groupView(g)};
    },{table:d=>groupTable([d])});
  cmd('group list','List resource groups.',[A('tag',['--tag'],{desc:'A single tag in \'key[=value]\' format.'})],[['List all resource groups located in the West US region.',"az group list --query \"[?location=='westus']\""]],v=>{
    let gs=groups();
    if(v.tag){const[k,val]=v.tag.split('=');gs=gs.filter(g=>k in g.tags&&(val==null||g.tags[k]===val))}
    return{data:gs.map(groupView)};
  },{table:groupTable});
  cmd('group show','Gets a resource group.',[A('name',['--name','--resource-group','-n','-g'],{req:true,cfg:'group',desc:'Name of resource group.'})],[['Get a resource group.','az group show -n MyResourceGroup']],v=>({data:groupView(needGroup(v.name))}),{table:d=>groupTable([d])});
  cmd('group exists','Check if a resource group exists.',[A('name',['--name','--resource-group','-n','-g'],{req:true,desc:'Name of resource group.'})],[['Check if \'MyResourceGroup\' exists.','az group exists -n MyResourceGroup']],v=>({data:!!findGroup(v.name)&&busy(findGroup(v.name))!=='Deleting'}));
  cmd('group delete','Delete a resource group.',[A('name',['--name','--resource-group','-n','-g'],{req:true,desc:'Name of resource group.'}),NOWAIT,YES,A('forceTypes',['--force-deletion-types','-f'],{choices:['Microsoft.Compute/virtualMachines','Microsoft.Compute/virtualMachineScaleSets','Microsoft.Databricks/workspaces'],desc:'The resource types you want to force delete.'})],
    [['Delete a resource group.','az group delete -n MyResourceGroup']],v=>{
      const g=needGroup(v.name);
      const go=()=>{
        if(g.p.managedBy)return{text:`cloudlab: este grupo lo gestiona un clúster AKS (managedBy). Borra el clúster con "az aks delete" y Azure eliminará también este grupo de nodos.`};
        if(busy(g)==='Deleting')return{};
        stat('groupDelete');
        if(v.noWait){g.busy={state:'Deleting',until:now()+30000};for(const x of S.res.filter(x=>x.sub===g.sub&&lc(x.rg)===lc(g.name)))x.busy={state:'Deleting',until:now()+30000};return{}}
        removeTree(g);return{};
      };
      return v.yes?go():confirm(go);
    });

  // ---------- Comandos: máquinas virtuales ----------
  const pubIp=()=>`${[20,4,52,13,172][Math.random()*5|0]}.${Math.random()*250+1|0}.${Math.random()*250+1|0}.${Math.random()*250+1|0}`;
  const mac=()=>Array.from({length:6},(_,i)=>i===0?'00':i===1?'0D':i===2?'3A':hexs(2).toUpperCase()).join('-');
  function resolveImage(img){
    const alias=Object.keys(IMAGES).find(k=>lc(k)===lc(img));
    if(alias)return{alias,urn:IMAGES[alias],windows:/^Win/.test(alias)};
    const parts=String(img).split(':');
    if(parts.length===4&&parts.every(Boolean))return{alias:null,urn:img,windows:/windows/i.test(parts[0]+parts[1])};
    err(`Invalid image "${img}". Use a valid image URN, custom image name, custom image id, VHD blob URI, or pick an image from [${Object.keys(IMAGES).map(k=>`'${k}'`).join(', ')}].\nSee vm create -h for more information on specifying an image.${/ubuntults|^ubuntu$/i.test(img)?'\ncloudlab: el alias UbuntuLTS se retiró; muchos tutoriales antiguos lo usan. Prueba con --image Ubuntu2204 o Ubuntu2404.':''}`);
  }
  function validatePassword(pw,linux){
    const max=linux?72:123;
    if(pw.length<12||pw.length>max)err(`The password length must be between 12 and ${max}`);
    const n=[/[a-z]/,/[A-Z]/,/\d/,/[^a-zA-Z0-9]/].filter(r=>r.test(pw)).length;
    if(n<3)err('Password must have the 3 of the following: 1 lower case character, 1 upper case character, 1 number and 1 special character.');
  }
  cmd('vm create','Create an Azure Virtual Machine.',[NAME('Name of the virtual machine.'),RG(),A('image',['--image'],{desc:'The name of the operating system image as a URN alias, URN, custom image name or ID, specialized VHD disk, or VHD blob URI. Use the alias with the distribution version, e.g. "Debian11" instead of "Debian". Find more aliases with `az vm image list`.'}),A('size',['--size'],{def:'Standard_D2s_v5',desc:'The VM size to be created. See https://azure.microsoft.com/pricing/details/virtual-machines/ for size info.'}),LOC(),A('admin',['--admin-username'],{desc:'Username for the VM. Default value is current username of OS. If the default value is system reserved, then default value will be set to azureuser.'}),A('password',['--admin-password'],{desc:'Password for the VM if authentication type is \'Password\'.'}),A('genKeys',['--generate-ssh-keys'],{type:'bool',desc:'Generate SSH public and private key files if missing. The keys will be stored in the ~/.ssh directory.'}),A('auth',['--authentication-type'],{choices:['all','password','ssh'],desc:'Type of authentication to use with the VM. Defaults to password for Windows and SSH public key for Linux.'}),A('vnet',['--vnet-name'],{desc:'Name of the virtual network when creating a new one or referencing an existing one.'}),A('subnet',['--subnet'],{desc:'The name of the subnet when creating a new VNet or referencing an existing one.'}),A('pip',['--public-ip-address'],{desc:'Name of the public IP address when creating one (default) or referencing an existing one. Can also reference an existing public IP by ID or specify "" for None (\'""\' in Azure CLI using PowerShell or --% operator).'}),A('zone',['--zone','-z'],{choices:['1','2','3'],desc:'Availability zone into which to provision the resource.'}),A('priority',['--priority'],{choices:['Low','Regular','Spot'],desc:'Priority. Use \'Spot\' to run short-lived workloads in a cost-effective way.'}),NOWAIT,TAGS],
    [['Create a default Ubuntu VM with automatic SSH authentication.','az vm create -n MyVm -g MyResourceGroup --image Ubuntu2204 --generate-ssh-keys'],['Create a small Windows VM.','az vm create -n MyWinVm -g MyResourceGroup --image Win2022Datacenter --size Standard_B2s --admin-username azureuser'],['Create a VM in an existing virtual network and subnet.','az vm create -n MyVm -g MyResourceGroup --image Debian11 --vnet-name MyVnet --subnet MySubnet --generate-ssh-keys']],v=>{
      const g=needGroup(v.rg,true);
      if(!v.image)err('usage error: --image IMAGE | --attach-os-disk DISK',2);
      const img=resolveImage(v.image);
      const loc=v.location?needLoc(v.location,'vm'):g.location;
      const name=v.name;
      if(img.windows&&(name.length>15||/^\d+$/.test(name)||/[`~!@#$%^&*()=+_[\]{}\\|;:.'",<>/?]/.test(name)))arm('InvalidParameter',"Windows computer name cannot be more than 15 characters long, be entirely numeric, or contain the following characters: ` ~ ! @ # $ % ^ & * ( ) = + _ [ ] { } \\ | ; : . ' \" , < > / ?.\nTarget: computerName");
      if(!img.windows&&(name.length>64||/[`~!@#$%^&*()=+_[\]{}\\|;:'",<>/?]/.test(name)))arm('InvalidParameter',"Linux host name cannot exceed 64 characters in length or contain the following characters: ` ~ ! @ # $ % ^ & * ( ) = + _ [ ] { } \\ | ; : ' \" , < > / ?.\nTarget: computerName");
      const size=sizeName(v.size||'Standard_D2s_v5');
      if(!size)arm('InvalidParameter',`The value ${v.size} provided for the VM size is not valid. The valid sizes in the current region are: ${Object.keys(SIZES).join(',')}.\nTarget: vmSize\ncloudlab: consulta los tamaños con az vm list-sizes -l ${loc} -o table`);
      const admin=v.admin||'azureuser';
      if(RESERVED_USERS.includes(lc(admin)))err(`This user name '${admin}' meets the general requirements, but is specifically disallowed for this image. Please try a different value.`);
      if(!img.windows&&/[A-Z\\/"[\]:|<>+=;,?*@#()!]|^[$-]/.test(admin))err('admin user name cannot contain upper case character A-Z, special characters \\/"[]:|<>+=;,?*@#()! or start with $ or -');
      const auth=v.auth||(img.windows||v.password?'password':'ssh');
      if(img.windows&&auth==='ssh')err('SSH not supported for Windows VMs.');
      const existing=findRes('vm',v.rg,name);
      if(existing)arm('PropertyChangeNotAllowed',`Changing property 'osProfile.adminUsername' is not allowed.\nTarget: osProfile.adminUsername\ncloudlab: ya existe una VM "${existing.name}" en el grupo ${existing.rg}. Usa otro nombre o bórrala con az vm delete.`);
      const finish=pw=>{
        if(pw!=null)validatePassword(pw,!img.windows);
        const warn=[];
        if(auth!=='password'&&!S.sshKeys){
          if(!v.genKeys)err('An RSA key file or key value must be supplied to SSH Key Value. You can use --generate-ssh-keys to let CLI generate one for you');
          S.sshKeys=true;
          warn.push("SSH key files '/home/user/.ssh/id_rsa' and '/home/user/.ssh/id_rsa.pub' have been generated under ~/.ssh to allow SSH access to the VM. If using machines without permanent storage, back up your keys to a safe location.");
        }
        if(SIZES[size][2].includes('NCAS')&&!['eastus','westeurope','southcentralus','westus2'].includes(loc))arm('SkuNotAvailable',`The requested VM size for resource 'Following SKUs have failed for Capacity Restrictions: ${size}' is currently not available in location '${loc}'. Please try another size or deploy to a different location or different zone. See https://aka.ms/azureskunotavailable for details.`);
        checkQuota(loc,size);
        // Red: reutiliza una VNet del grupo en la misma región o crea <vm>VNET con <vm>Subnet.
        let vnet=v.vnet?findRes('vnet',v.rg,v.vnet):resOf('vnet',v.rg).find(x=>x.location===loc);
        if(vnet&&vnet.location!==loc)arm('InvalidResourceReference',`Resource ${resId(vnet)} referenced by resource ${resId({t:'nic',sub:curSub(),rg:g.name,name:name+'VMNic'})} was not found. Please make sure that the referenced resource exists, and that both resources are in the same region.`);
        if(!vnet)vnet=add({t:'vnet',name:v.vnet||`${name}VNET`,rg:g.name,location:loc,p:{prefixes:['10.0.0.0/16'],subnets:[{name:v.subnet||`${name}Subnet`,prefix:'10.0.0.0/24',etag:guid()}],etag:guid(),guid:guid()}});
        let sn=v.subnet?vnet.p.subnets.find(s=>lc(s.name)===lc(v.subnet)):vnet.p.subnets[0];
        if(!sn){const free=nextSubnet(vnet);if(!free)arm('NetcfgSubnetRangeOutsideVnet',`Subnet '${v.subnet}' is not valid because its IP address range is outside the IP address range of virtual network '${vnet.name}'.`);sn={name:v.subnet,prefix:free,etag:guid()};vnet.p.subnets.push(sn)}
        const used=S.res.filter(n=>n.t==='nic'&&n.p.subnet===`${resId(vnet)}/subnets/${sn.name}`).map(n=>n.p.ip);
        const c=cidr(sn.prefix);let ip=c.start+4;while(used.includes(n2ip(ip)))ip++;
        let pip=null;
        if(v.pip!==''&&v.pip!=='""')pip=add({t:'pip',name:v.pip||`${name}PublicIP`,rg:g.name,location:loc,p:{ip:pubIp()}});
        const nsg=add({t:'nsg',name:`${name}NSG`,rg:g.name,location:loc,p:{rules:[img.windows?'rdp':'default-allow-ssh']}});
        const nic=add({t:'nic',name:`${name}VMNic`,rg:g.name,location:loc,p:{vm:name,ip:n2ip(ip),mac:mac(),subnet:`${resId(vnet)}/subnets/${sn.name}`,pip:pip&&resId(pip),nsg:resId(nsg)}});
        const disk=add({t:'disk',name:`${name}_OsDisk_1_${hexs(32)}`,rg:g.name.toUpperCase(),location:loc,p:{vm:name,size:img.windows?127:30}});
        const vm=add({t:'vm',name,rg:g.name,location:loc,tags:tagsOf(v.tags),p:{size,image:img.alias||img.urn,urn:img.urn.replace(/:latest$/,':latest'),windows:img.windows,admin,auth,power:'running',nic:resId(nic),disk:resId(disk),vmId:guid(),zone:v.zone||null,priority:v.priority||'Regular'}});
        disk.rg=g.name.toUpperCase();
        stat('vmCreate');
        if(v.noWait){vm.busy={state:'Creating',until:now()+45000};return{warn}}
        return{warn,data:{fqdns:'',id:resId(vm),location:loc,macAddress:nic.p.mac,powerState:'VM running',privateIpAddress:nic.p.ip,publicIpAddress:pip?pip.p.ip:'',resourceGroup:g.name,zones:v.zone||''}};
      };
      if(auth!=='ssh'&&v.password==null){
        const ask1=new Ask('Admin Password: ',pw=>{throw new Ask('Confirm Admin Password: ',pw2=>{if(pw!==pw2)throw Object.assign(new Ask('Passwords do not match.\nAdmin Password: ',ask1.cont,true));return finish(pw)},true)},true);
        throw ask1;
      }
      return finish(v.password);
    });
  function vmFind(v){return needRes('vm',v.rg,v.name)}
  const powerCmd=(key,desc,long,fn,ex)=>cmd(key,desc,[NAME('The name of the Virtual Machine. You can configure the default using `az configure --defaults vm=<name>`.'),RG(),NOWAIT,...(key==='vm stop'?[A('skipShutdown',['--skip-shutdown'],{type:'bool',desc:'Skip shutdown and power-off immediately.'})]:[])],ex,v=>{const vm=vmFind(v);if(busy(vm))arm('OperationNotAllowed',`Operation '${key.split(' ')[1]}' is not allowed on VM '${vm.name}' since the VM is ${lc(busy(vm))}.`,1);return fn(vm,v)||{}},{long});
  powerCmd('vm start','Start a stopped VM.',null,vm=>{if(vm.p.power==='deallocated')checkQuota(vm.location,vm.p.size);vm.p.power='running';stat('vmStart')},[['Start a stopped VM.','az vm start -g MyResourceGroup -n MyVm']]);
  powerCmd('vm stop','Power off (stop) a running VM.','The VM will continue to be billed. To avoid this, you can deallocate the VM through "az vm deallocate".',vm=>{if(vm.p.power!=='deallocated')vm.p.power='stopped';stat('vmStop');return{warn:['cloudlab: la VM está apagada pero sigue asignada, así que Azure sigue cobrando el cómputo. Para dejar de pagarlo usa az vm deallocate.']}},[['Power off (stop) a running VM.','az vm stop -g MyResourceGroup -n MyVm']]);
  powerCmd('vm deallocate','Deallocate a VM so that computing resources are no longer allocated (charges no longer apply). The status will change from \'Stopped\' to \'Stopped (Deallocated)\'.',null,vm=>{vm.p.power='deallocated';stat('vmDeallocate')},[['Deallocate a VM.','az vm deallocate -g MyResourceGroup -n MyVm']]);
  powerCmd('vm restart','Restart VMs.',null,vm=>{if(vm.p.power!=='running')arm('OperationNotAllowed',`Operation 'restart' is not allowed on VM '${vm.name}' since the VM is ${vm.p.power==='deallocated'?'deallocated':'not running'}.`);},[['Restart a VM.','az vm restart -g MyResourceGroup -n MyVm']]);
  cmd('vm list','List details of Virtual Machines.',[RG(false),A('details',['--show-details','-d'],{type:'bool',desc:'Show public ip address, FQDN, and power states. command will run slow.'})],[['List all VMs.','az vm list'],['List all VMs by resource group with details.','az vm list -g MyResourceGroup -d -o table']],v=>{if(v.rg)needGroup(v.rg);return{data:resOf('vm',v.rg).map(x=>vmView(x,v.details))}},{table:vmTable});
  cmd('vm show','Get the details of a VM.',[NAME('The name of the Virtual Machine. You can configure the default using `az configure --defaults vm=<name>`.'),RG(),A('details',['--show-details','-d'],{type:'bool',desc:'Show public ip address, FQDN, and power states. command will run slow.'})],[['Show information about a VM.','az vm show -g MyResourceGroup -n MyVm -d']],v=>({data:vmView(vmFind(v),v.details)}),{table:d=>vmTable([d])});
  cmd('vm delete','Delete a VM.',[NAME('The name of the Virtual Machine.'),RG(),YES,NOWAIT,A('forceDeletion',['--force-deletion'],{type:'tbool',desc:'Optional parameter to force delete virtual machines.'})],[['Delete a VM without a prompt for confirmation.','az vm delete -g MyResourceGroup -n MyVm --yes']],v=>{
    const vm=vmFind(v);
    const go=()=>{del(vm);for(const x of S.res.filter(x=>(x.t==='nic'||x.t==='disk')&&x.p.vm===vm.name&&lc(x.rg)===lc(vm.rg)))x.p.orphan=true;stat('vmDelete');return{}};
    return v.yes?go():confirm(go);
  });
  cmd('vm list-sizes','List available sizes for VMs.',[A('location',['--location','-l'],{req:true,cfg:'location',desc:'Location. Values from: `az account list-locations`.'})],[['List the available VM sizes in the West US region.','az vm list-sizes -l westus']],v=>{
    needLoc(v.location,'vm');
    return{warn:["This command has been deprecated and will be removed in a future release. Use 'vm list-skus' instead."],data:Object.entries(SIZES).map(([n,[c,m]])=>({maxDataDiskCount:Math.min(64,c*4),memoryInMB:m,name:n,numberOfCores:c,osDiskSizeInMB:1047552,resourceDiskSizeInMB:/B|_v5|_v2$/.test(n)&&!/ds_v5/.test(n)?0:c*16384}))};
  });
  cmd('vm list-usage','List available usage resources for VMs.',[A('location',['--location','-l'],{req:true,cfg:'location',desc:'Location. Values from: `az account list-locations`.'})],[['Get the compute resource usage for the West US region.','az vm list-usage -l westus -o table']],v=>{
    const loc=needLoc(v.location,'vm'),u=coreUsage(loc);
    const fams=[...new Set(Object.values(SIZES).map(s=>s[2]))];
    return{data:[{currentValue:0,limit:2500,localName:'Availability Sets',name:{localizedValue:'Availability Sets',value:'availabilitySets'},unit:'Count'},{currentValue:u.total,limit:QUOTA,localName:'Total Regional vCPUs',name:{localizedValue:'Total Regional vCPUs',value:'cores'},unit:'Count'},{currentValue:u.vms,limit:25000,localName:'Virtual Machines',name:{localizedValue:'Virtual Machines',value:'virtualMachines'},unit:'Count'},{currentValue:S.res.filter(a=>a.t==='aks'&&inSub(a)&&a.location===loc).length,limit:2500,localName:'Virtual Machine Scale Sets',name:{localizedValue:'Virtual Machine Scale Sets',value:'virtualMachineScaleSets'},unit:'Count'},...fams.map(f=>({currentValue:u.fam[f]||0,limit:FAMILY_LIMIT(f),localName:FAMILY_NAME(f),name:{localizedValue:FAMILY_NAME(f),value:f},unit:'Count'}))]};
  },{table:d=>d.map(x=>({Name:x.localName,CurrentValue:x.currentValue,Limit:x.limit}))});
  cmd('vm image list','List the VM/VMSS images available in the Azure Marketplace.',[A('all',['--all'],{type:'bool',desc:'Retrieve image list from live Azure service rather using an offline image list.'}),LOC(),A('publisher',['--publisher','-p'],{desc:'Image publisher.'}),A('offer',['--offer','-f'],{desc:'Image offer.'})],[['List all available images.','az vm image list -o table']],v=>{
    let d=Object.entries(IMAGES).map(([alias,urn])=>{const[publisher,offer,sku,version]=urn.split(':');return{architecture:'x64',offer,publisher,sku,urn,urnAlias:alias,version}});
    if(v.publisher)d=d.filter(x=>lc(x.publisher).includes(lc(v.publisher)));
    if(v.offer)d=d.filter(x=>lc(x.offer).includes(lc(v.offer)));
    return{warn:v.all?['cloudlab: --all consultaría el Marketplace completo (miles de imágenes); aquí se muestra la lista sin conexión.']:['You are viewing an offline list of images, use --all to retrieve an up-to-date list'],data:d};
  },{login:false});

  // ---------- Comandos: almacenamiento ----------
  const STORAGE_RE=/^[a-z0-9]{3,24}$/;
  const storageTaken=n=>TAKEN_STORAGE.includes(n)||S.res.some(r=>r.t==='storage'&&r.name===n);
  cmd('storage account create','Create a storage account.',[NAME('The storage account name.'),RG(),LOC(),A('sku',['--sku'],{choices:STORAGE_SKUS,def:'Standard_RAGRS',desc:'The storage account SKU.'}),A('kind',['--kind'],{choices:['BlobStorage','BlockBlobStorage','FileStorage','Storage','StorageV2'],def:'StorageV2',desc:'Indicate the type of storage account.'}),A('tier',['--access-tier'],{choices:['Cold','Cool','Hot','Premium'],desc:'Required for storage accounts where kind = BlobStorage. The access tier is used for billing.'}),A('https',['--https-only'],{type:'tbool',desc:'Allow https traffic only to storage service if set to true.'}),A('blobPublic',['--allow-blob-public-access'],{type:'tbool',desc:'Allow or disallow public access to all blobs or containers in the storage account.'}),A('tls',['--min-tls-version'],{choices:['TLS1_0','TLS1_1','TLS1_2','TLS1_3'],desc:'The minimum TLS version to be permitted on requests to storage.'}),TAGS],
    [['Create a storage account \'mystorageaccount\' in resource group \'MyResourceGroup\' in the West US region with locally redundant storage.','az storage account create -n mystorageaccount -g MyResourceGroup -l westus --sku Standard_LRS']],v=>{
      const g=needGroup(v.rg,true);
      const n=v.name;
      if(!STORAGE_RE.test(n))arm('AccountNameInvalid',`${n} is not a valid storage account name. Storage account name must be between 3 and 24 characters in length and use numbers and lower-case letters only.`);
      const loc=v.location?needLoc(v.location,'storage'):g.location;
      const mine=S.res.find(r=>r.t==='storage'&&r.name===n);
      if(mine&&!(mine.sub===curSub()&&lc(mine.rg)===lc(g.name))){if(mine.sub===curSub())arm('StorageAccountAlreadyExists',`The storage account named ${n} already exists under the subscription.`);arm('StorageAccountAlreadyTaken',`The storage account named ${n} is already taken.`)}
      if(!mine&&TAKEN_STORAGE.includes(n))arm('StorageAccountAlreadyTaken',`The storage account named ${n} is already taken.\ncloudlab: el nombre de una cuenta de almacenamiento es único en todo Azure (forma parte de https://${n}.blob.core.windows.net). Prueba con algo más personal, p. ej. st${n}${String(now()).slice(-4)}.`);
      const sku=v.sku||'Standard_RAGRS';
      if(sku.startsWith('Premium')&&(v.kind||'StorageV2')==='BlobStorage')err(`usage error: --sku ${sku} is not supported with --kind BlobStorage`);
      if(/ZRS/.test(sku)&&!REGION[loc].zones)arm('RedundancyConfigurationNotAvailableInRegion',`The requested storage account SKU '${sku}' is not supported in region '${loc}'. Region doesn't support zone-redundant storage.`);
      const s=mine||add({t:'storage',name:n,rg:g.name,location:loc,p:{}});
      Object.assign(s.p,{sku,kind:v.kind||'StorageV2',tier:v.tier||'Hot',https:v.https!==false});
      if(v.tags)s.tags=tagsOf(v.tags);
      stat('storageCreate');
      return{data:storageView(s)};
    },{table:d=>storageTable([d])});
  cmd('storage account list','List storage accounts.',[RG(false)],[['List all storage accounts in a subscription.','az storage account list'],['List all storage accounts in a resource group.','az storage account list -g MyResourceGroup -o table']],v=>{if(v.rg)needGroup(v.rg);return{data:resOf('storage',v.rg).map(storageView)}},{table:d=>storageTable(d)});
  const storageTable=d=>d.map(s=>({AccessTier:s.accessTier,AllowBlobPublicAccess:s.allowBlobPublicAccess,CreationTime:s.creationTime,EnableHttpsTrafficOnly:s.enableHttpsTrafficOnly,Kind:s.kind,Location:s.location,MinimumTlsVersion:s.minimumTlsVersion,Name:s.name,PrimaryLocation:s.primaryLocation,ProvisioningState:s.provisioningState,ResourceGroup:s.resourceGroup,StatusOfPrimary:s.statusOfPrimary,SecondaryLocation:s.secondaryLocation,StatusOfSecondary:s.statusOfSecondary}));
  cmd('storage account show','Show storage account properties.',[NAME('The storage account name.'),RG()],[['Show properties for a storage account by resource ID.','az storage account show -g MyResourceGroup -n mystorageaccount']],v=>({data:storageView(needRes('storage',v.rg,v.name))}),{table:d=>storageTable([d])});
  cmd('storage account delete','Delete a storage account.',[NAME('The storage account name.'),RG(),YES],[['Delete a storage account using name and resource group.','az storage account delete -n mystorageaccount -g MyResourceGroup']],v=>{
    const s=needRes('storage',v.rg,v.name);
    const go=()=>{del(s);return{}};
    return v.yes?go():confirm(go);
  });
  cmd('storage account check-name','Check that the storage account name is valid and is not already in use.',[NAME('The storage account name.')],[['Check if a storage account name is available.','az storage account check-name --name mystorageaccount']],v=>{
    const n=v.name;
    if(!STORAGE_RE.test(n))return{data:{message:`${n} is not a valid storage account name. Storage account name must be between 3 and 24 characters in length and use numbers and lower-case letters only.`,nameAvailable:false,reason:'AccountNameInvalid'}};
    if(storageTaken(n))return{data:{message:`The storage account named ${n} is already taken.`,nameAvailable:false,reason:'AlreadyExists'}};
    return{data:{message:null,nameAvailable:true,reason:null}};
  });

  // ---------- Comandos: redes virtuales ----------
  function checkPrefix(p,res){
    const c=cidr(p);
    if(!c)arm('InvalidAddressPrefixFormat',`Address prefix ${p} of resource ${res} is not formatted correctly. It should follow CIDR notation, for example 10.0.0.0/24.`);
    if(c.base!==c.start)arm('InvalidCIDRNotation',`The address prefix ${p} in resource ${res} has an invalid CIDR notation. For the given prefix length, the address prefix should be ${c.net}.`);
    return c;
  }
  function nextSubnet(vnet){
    for(const p of vnet.p.prefixes){const c=cidr(p);for(let b=c.start;b+255<=c.end;b+=256){const n=n2ip(b)+'/24',x=cidr(n);if(!vnet.p.subnets.some(s=>{const y=cidr(s.prefix);return x.start<=y.end&&y.start<=x.end}))return n}}
    return null;
  }
  function addSubnet(vnet,name,prefix){
    const sid=`${resId(vnet)}/subnets/${name}`;
    const c=checkPrefix(prefix,sid);
    if(c.bits>29)arm('InvalidRequestFormat',`Subnet ${name} has a prefix /${c.bits}; the smallest supported subnet in Azure is /29.`);
    if(!vnet.p.prefixes.some(p=>{const v=cidr(p);return c.start>=v.start&&c.end<=v.end}))arm('NetcfgSubnetRangeOutsideVnet',`Subnet '${name}' is not valid because its IP address range is outside the IP address range of virtual network '${vnet.name}'.`);
    const other=vnet.p.subnets.find(s=>lc(s.name)!==lc(name)&&(y=>c.start<=y.end&&y.start<=c.end)(cidr(s.prefix)));
    if(other)arm('NetcfgSubnetRangesOverlap',`Subnet '${name}' is not valid because its IP address range overlaps with that of an existing subnet '${other.name}' in virtual network '${vnet.name}'.`);
    let sn=vnet.p.subnets.find(s=>lc(s.name)===lc(name));
    if(sn){if(S.res.some(n=>n.t==='nic'&&n.p.subnet===`${resId(vnet)}/subnets/${sn.name}`)&&sn.prefix!==prefix)arm('InUseSubnetCannotBeUpdated',`Subnet ${sn.name} is in use and cannot be updated.`);sn.prefix=c.net;sn.etag=guid()}
    else{sn={name,prefix:c.net,etag:guid()};vnet.p.subnets.push(sn)}
    return sn;
  }
  cmd('network vnet create','Create a virtual network.',[NAME('The virtual network (VNet) name.'),RG(),LOC(),A('prefixes',['--address-prefixes','--address-prefix'],{type:'list',desc:'Space-separated list of IP address prefixes for the VNet.  Default: 10.0.0.0/16.'}),A('subnetName',['--subnet-name'],{desc:'Name of a new subnet to create within the VNet.'}),A('subnetPrefixes',['--subnet-prefixes','--subnet-prefix'],{type:'list',desc:'Space-separated list of address prefixes in CIDR format for the new subnet. If omitted, automatically reserves a /24 (or as large as available) block within the VNet address space.'}),A('dns',['--dns-servers'],{type:'list',desc:'Space-separated list of DNS server IP addresses.'}),TAGS],
    [['Create a virtual network with a specific address prefix and one subnet.','az network vnet create -g MyResourceGroup -n MyVnet --address-prefix 10.0.0.0/16 --subnet-name MySubnet --subnet-prefixes 10.0.0.0/24']],v=>{
      const g=needGroup(v.rg,true);
      const loc=v.location?needLoc(v.location,'vnet'):g.location;
      const prefixes=(v.prefixes||['10.0.0.0/16']).map(p=>checkPrefix(p,`/subscriptions/${curSub()}/resourceGroups/${g.name}/providers/${TYPES.vnet}/${v.name}`).net);
      let vnet=findRes('vnet',g.name,v.name);
      if(vnet&&vnet.location!==loc)arm('InvalidResourceLocation',`The resource '${v.name}' already exists in location '${vnet.location}' in resource group '${g.name}'. A resource with the same name cannot be created in location '${loc}'. Please select a new resource name.`);
      if(!vnet)vnet=add({t:'vnet',name:v.name,rg:g.name,location:loc,p:{prefixes,subnets:[],etag:guid(),guid:guid()}});
      else vnet.p.prefixes=prefixes;
      if(v.subnetName)addSubnet(vnet,v.subnetName,(v.subnetPrefixes||[])[0]||nextSubnet(vnet)||prefixes[0]);
      if(v.tags)vnet.tags=tagsOf(v.tags);
      stat('vnetCreate');
      return{data:{newVNet:vnetView(vnet)}};
    });
  const vnetTable=d=>d.map(x=>({Name:x.name,ResourceGroup:x.resourceGroup,Location:x.location,NumSubnets:x.subnets.length,Prefixes:x.addressSpace.addressPrefixes.join(', '),DnsServers:'',DDOSProtection:false,VMProtection:false}));
  cmd('network vnet list','List virtual networks.',[RG(false)],[['List all virtual networks in a resource group.','az network vnet list -g MyResourceGroup -o table']],v=>{if(v.rg)needGroup(v.rg);return{data:resOf('vnet',v.rg).map(vnetView)}},{table:vnetTable});
  cmd('network vnet show','Get the details of a virtual network.',[NAME('The virtual network (VNet) name.'),RG()],[['Get details for MyVNet.','az network vnet show -g MyResourceGroup -n MyVNet']],v=>({data:vnetView(needRes('vnet',v.rg,v.name))}),{table:d=>vnetTable([d])});
  cmd('network vnet delete','Delete a virtual network.',[NAME('The virtual network (VNet) name.'),RG(),NOWAIT],[['Delete a virtual network.','az network vnet delete -g MyResourceGroup -n myVNet']],v=>{
    const vnet=needRes('vnet',v.rg,v.name);
    const nic=S.res.find(n=>n.t==='nic'&&n.p.subnet.startsWith(resId(vnet)+'/subnets/'));
    if(nic){const sn=nic.p.subnet.split('/').pop();arm('InUseSubnetCannotBeDeleted',`Subnet ${sn} is in use by ${resId(nic)}/ipConfigurations/ipconfig${nic.p.vm} and cannot be deleted. In order to delete the subnet, delete all the resources within the subnet. See aka.ms/deletesubnet.`)}
    del(vnet);return{};
  });
  cmd('network vnet subnet create','Create a subnet and associate an existing NSG and route table.',[NAME('The subnet name.'),RG(),A('vnet',['--vnet-name'],{req:true,desc:'The virtual network (VNet) name.'}),A('prefixes',['--address-prefixes','--address-prefix'],{type:'list',desc:'Space-separated list of address prefixes in CIDR format.'}),A('nsg',['--network-security-group'],{desc:'Name or ID of a network security group (NSG).'})],
    [['Create new subnet attached to an NSG with a custom route table.','az network vnet subnet create -g MyResourceGroup --vnet-name MyVnet -n MySubnet --address-prefixes 10.0.0.0/24']],v=>{
      const vnet=needRes('vnet',v.rg,v.vnet);
      if(!v.prefixes)arm('InvalidRequestFormat',`Cannot parse the request.\ncloudlab: indica el rango de la subred con --address-prefixes, p. ej. ${nextSubnet(vnet)||'10.0.1.0/24'}`);
      const sn=addSubnet(vnet,v.name,v.prefixes[0]);
      stat('subnetCreate');
      return{data:subnetView(vnet,sn)};
    },{table:d=>subnetTable([d])});
  const subnetTable=d=>d.map(x=>({AddressPrefix:x.addressPrefix,Name:x.name,PrivateEndpointNetworkPolicies:x.privateEndpointNetworkPolicies,PrivateLinkServiceNetworkPolicies:x.privateLinkServiceNetworkPolicies,ProvisioningState:x.provisioningState,ResourceGroup:x.resourceGroup}));
  cmd('network vnet subnet list','List the subnets in a virtual network.',[RG(),A('vnet',['--vnet-name'],{req:true,desc:'The virtual network (VNet) name.'})],[['List the subnets in a virtual network.','az network vnet subnet list -g MyResourceGroup --vnet-name MyVNet -o table']],v=>{const vnet=needRes('vnet',v.rg,v.vnet);return{data:vnet.p.subnets.map(sn=>subnetView(vnet,sn))}},{table:d=>subnetTable(d)});
  cmd('network vnet subnet delete','Delete a subnet.',[NAME('The subnet name.'),RG(),A('vnet',['--vnet-name'],{req:true,desc:'The virtual network (VNet) name.'})],[['Delete a subnet.','az network vnet subnet delete -g MyResourceGroup -n MySubnet --vnet-name MyVNet']],v=>{
    const vnet=needRes('vnet',v.rg,v.vnet),sn=vnet.p.subnets.find(s=>lc(s.name)===lc(v.name));
    if(!sn)return{};
    const nic=S.res.find(n=>n.t==='nic'&&n.p.subnet===`${resId(vnet)}/subnets/${sn.name}`);
    if(nic)arm('InUseSubnetCannotBeDeleted',`Subnet ${sn.name} is in use by ${resId(nic)}/ipConfigurations/ipconfig${nic.p.vm} and cannot be deleted. In order to delete the subnet, delete all the resources within the subnet. See aka.ms/deletesubnet.`);
    vnet.p.subnets=vnet.p.subnets.filter(s=>s!==sn);return{};
  });

  // ---------- Comandos: App Service ----------
  cmd('appservice plan create','Create an app service plan.',[NAME('Name of the new app service plan.'),RG(),LOC(),A('sku',['--sku'],{choices:PLAN_SKUS,desc:'The pricing tiers, e.g., F1(Free), D1(Shared), B1(Basic Small), B2(Basic Medium), B3(Basic Large), S1(Standard Small), P1V2(Premium V2 Small), P0V3(Premium V3 Extra Small), P1V3(Premium V3 Small), P1V4(Premium V4 Small)...'}),A('linux',['--is-linux'],{type:'tbool',desc:'Host web app on Linux worker. Defaults to true unless --hyper-v is specified. Use "--is-linux false" to create a Windows plan.'}),A('workers',['--number-of-workers'],{type:'int',def:1,desc:'Number of workers to be allocated.'}),NOWAIT,TAGS],
    [['Create a Linux app service plan.','az appservice plan create -g MyResourceGroup -n MyPlan --is-linux'],['Create a Windows app service plan with a specific SKU.','az appservice plan create -g MyResourceGroup -n MyPlan --sku B1 --is-linux false']],v=>{
      const g=needGroup(v.rg,true);
      const loc=v.location?needLoc(v.location,'plan'):g.location;
      const sku=(v.sku||'B1').toUpperCase();
      if(!/^[a-zA-Z0-9-]{1,60}$/.test(v.name))err(`Plan name '${v.name}' is invalid. It can only contain letters, numbers and hyphens (max 60 characters).`);
      const linux=v.linux!==false;
      const free=S.res.filter(p=>p.t==='plan'&&inSub(p)&&p.location===loc&&(p.p.sku==='F1'||p.p.sku==='FREE')&&p.p.linux===linux&&lc(p.name)!==lc(v.name));
      if((sku==='F1'||sku==='FREE')&&free.length>=1)arm('Conflict',`The maximum number of Free ${linux?'Linux ':''}ServerFarms allowed in a Subscription is 1.\ncloudlab: Azure solo permite un plan gratuito (F1) ${linux?'Linux ':''}por región y suscripción. Ya tienes "${free[0].name}".`);
      let p=findRes('plan',g.name,v.name);
      if(p&&p.p.linux!==linux)arm('Conflict',`Server farm with name ${v.name} already exists with a different OS type.`);
      if(!p)p=add({t:'plan',name:v.name,rg:g.name,location:loc,p:{}});
      Object.assign(p.p,{sku,linux,workers:v.workers||1});
      if(v.tags)p.tags=tagsOf(v.tags);
      stat('planCreate');
      return v.noWait?{}:{data:planView(p)};
    },{table:d=>planTable([d])});
  const planTable=d=>d.map(p=>({Name:p.name,Location:p.location,Kind:p.kind,Sku:p.sku.name,Tier:p.sku.tier,Workers:p.numberOfWorkers,Sites:p.numberOfSites,ResourceGroup:p.resourceGroup}));
  cmd('appservice plan list','List app service plans.',[RG(false)],[['List all free tier App Service plans.',"az appservice plan list --query \"[?sku.tier=='Free']\""]],v=>{if(v.rg)needGroup(v.rg);return{data:resOf('plan',v.rg).map(planView)}},{table:planTable});
  cmd('appservice plan delete','Delete an app service plan.',[NAME('The name of the app service plan.'),RG(),YES],[['Delete an app service plan.','az appservice plan delete --name MyAppServicePlan --resource-group MyResourceGroup']],v=>{
    const p=needRes('plan',v.rg,v.name);
    const go=()=>{if(S.res.some(w=>w.t==='webapp'&&w.p.plan===resId(p)))arm('Conflict',`Server farm '${p.name}' cannot be deleted because it has web app(s) ${S.res.filter(w=>w.t==='webapp'&&w.p.plan===resId(p)).map(w=>w.name).join(',')} assigned to it.`);del(p);return{}};
    return v.yes?go():confirm(go);
  });
  cmd('webapp create','Create a web app.',[NAME('Name of the new web app. Web app name can contain only allow alphanumeric characters and hyphens, it cannot start or end in a hyphen, and must be less than 64 characters.'),RG(),A('plan',['--plan','-p'],{desc:'Name or resource id of the app service plan. Use \'appservice plan create\' to get one. If using an App Service plan from a different resource group, the full resource id must be used and not the plan name.'}),A('runtime',['--runtime','-r'],{desc:'Canonicalized web runtime in the format of Framework:Version, e.g. "PHP:8.4". Use `az webapp list-runtimes` for available list.'}),A('deployLocalGit',['--deployment-local-git'],{type:'bool',desc:'Enable local git.'}),TAGS],
    [['Create a web app with the default configuration.','az webapp create -g MyResourceGroup -p MyPlan -n MyUniqueAppName'],['Create a web app with a NodeJS 22 runtime.','az webapp create -g MyResourceGroup -p MyPlan -n MyUniqueAppName --runtime "NODE:22-lts"']],v=>{
      const g=needGroup(v.rg,true);
      if(!v.plan)err(`usage error: --plan NAME_OR_ID | --flexconsumption-location LOCATION | --container-apps ENVIRONMENT`,2);
      const plan=v.plan.startsWith('/')?S.res.find(p=>p.t==='plan'&&lc(resId(p))===lc(v.plan)):findRes('plan',g.name,v.plan);
      if(!plan)err(`The plan '${v.plan}' doesn't exist in the resource group '${g.name}'.`,3);
      const n=v.name;
      if(!/^[a-zA-Z0-9]([a-zA-Z0-9-]{0,58}[a-zA-Z0-9])?$/.test(n))arm('InvalidResourceName',`Resource name ${n} is invalid. The name can contain only letters, numbers and hyphens; it cannot start or end with a hyphen and must be between 2 and 60 characters.`);
      const mine=S.res.find(w=>w.t==='webapp'&&lc(w.name)===lc(n));
      if(mine&&lc(mine.rg)===lc(g.name)&&mine.sub===curSub()){return{warn:[`Webapp '${mine.name}' already exists. The command will use the existing app's settings.`],data:siteView(mine)}}
      if(mine||TAKEN_SITES.includes(lc(n)))arm('Conflict',`Website with given name ${n} already exists.${mine?'':`\ncloudlab: el nombre forma parte de https://${n}.azurewebsites.net y es único en todo Azure. Prueba con algo como ${n}-${String(now()).slice(-5)}.`}`);
      let runtime=v.runtime?v.runtime.replace('|',':'):null;
      const os=plan.p.linux?'linux':'windows';
      if(runtime){const m=RUNTIMES[os].find(r=>lc(r)===lc(runtime));if(!m)err(`${plan.p.linux?'Linux':'Windows'} Runtime '${v.runtime}' is not supported. Run 'az webapp list-runtimes --os-type ${os}' to cross check`);runtime=m}
      const w=add({t:'webapp',name:n,rg:g.name,location:plan.location,tags:tagsOf(v.tags),p:{plan:resId(plan),linux:plan.p.linux,runtime:runtime||'',state:'Running',ips:Array.from({length:4},pubIp)}});
      stat('webappCreate');
      return{data:siteView(w)};
    });
  cmd('webapp list','List web apps.',[RG(false)],[['List all web apps in MyResourceGroup.','az webapp list --resource-group MyResourceGroup -o table'],['List default host name and state for all web apps.','az webapp list --query "[].{hostName: defaultHostName, state: state}"']],v=>{if(v.rg)needGroup(v.rg);return{data:resOf('webapp',v.rg).map(siteView)}},{table:siteTable});
  cmd('webapp show','Get the details of a web app.',[NAME('Name of the web app.'),RG()],[['Get the details of a web app.','az webapp show --name MyWebapp --resource-group MyResourceGroup']],v=>({data:siteView(needRes('webapp',v.rg,v.name))}),{table:d=>siteTable([d])});
  cmd('webapp browse','Open a web app in a browser. This is not supported in Azure Cloud Shell.',[NAME('Name of the web app.'),RG(),A('logs',['--logs','-l'],{type:'bool',desc:'Enable viewing the log stream immediately after launching the web app.'})],[['Open a web app in a browser.','az webapp browse --name MyWebapp --resource-group MyResourceGroup']],v=>{
    const w=needRes('webapp',v.rg,v.name);
    stat('webappBrowse');
    if(w.p.state!=='Running')return{text:`cloudlab: se abriría https://${w.name}.azurewebsites.net, pero la app está detenida: el navegador mostraría "Error 403 - This web app is stopped."`};
    return{text:`cloudlab: se abriría https://${w.name}.azurewebsites.net en tu navegador. Vista previa de lo que verías:\n\n  ┌${'─'.repeat(58)}┐\n  │  ${pad('Microsoft Azure',56)}│\n  │  ${pad('',56)}│\n  │  ${pad('Your web app is running and waiting for your content',56)}│\n  │  ${pad(w.name+'.azurewebsites.net',56)}│\n  │  ${pad(w.p.runtime?'Runtime: '+w.p.runtime:'Sin pila de ejecución configurada',56)}│\n  └${'─'.repeat(58)}┘`};
  });
  cmd('webapp delete','Delete a web app.',[NAME('Name of the web app.'),RG(),A('keepPlan',['--keep-empty-plan'],{type:'bool',desc:'Keep empty app service plan.'})],[['Delete a web app.','az webapp delete --name MyWebapp --resource-group MyResourceGroup']],v=>{const w=needRes('webapp',v.rg,v.name);del(w);return{}});
  cmd('webapp list-runtimes','List available built-in stacks which can be used for web apps.',[A('os',['--os-type','--os'],{choices:['linux','windows'],desc:'Limit the output to just windows or linux runtimes.'})],[['List available built-in stacks for Linux web apps.','az webapp list-runtimes --os-type linux']],v=>({data:v.os?RUNTIMES[v.os]:{linux:RUNTIMES.linux,windows:RUNTIMES.windows}}),{login:false});

  // ---------- Comandos: AKS ----------
  const aksFind=v=>needRes('aks',v.rg,v.name);
  function aksBusy(a){const b=busy(a);if(b)arm('OperationNotAllowed',`Operation is not allowed because there's an in progress ${b==='Creating'?'create managed cluster':lc(b)} operation which started at ${iso(a.busy.from||a.created)}. Please wait for it to complete before retrying.`)}
  cmd('aks create','Create a new managed Kubernetes cluster.',[NAME('Name of the managed cluster.'),RG(),LOC(),A('count',['--node-count','-c'],{type:'int',def:3,desc:'Number of nodes in the Kubernetes node pool. After creating a cluster, you can change the size of its node pool with `az aks scale`.'}),A('vmSize',['--node-vm-size','-s'],{desc:'Size of Virtual Machines to create as Kubernetes nodes. If the user does not specify one, server will select a default VM size for her/him.'}),A('version',['--kubernetes-version','-k'],{desc:'Version of Kubernetes to use for creating the cluster, such as "1.16.9". Values from: `az aks get-versions`.'}),A('genKeys',['--generate-ssh-keys'],{type:'bool',desc:'Generate SSH public and private key files if missing. The keys will be stored in the ~/.ssh directory.'}),A('noSsh',['--no-ssh-key','-x'],{type:'bool',desc:'Do not use or create a local SSH key.'}),A('tier',['--tier'],{choices:['free','premium','standard'],desc:"Specify SKU tier for managed clusters. '--tier standard' enables a standard managed cluster service with a financially backed SLA. '--tier free' does not have a financially backed SLA."}),A('plugin',['--network-plugin'],{choices:['azure','kubenet','none'],desc:'The Kubernetes network plugin to use.'}),A('addons',['--enable-addons','-a'],{desc:'Enable the Kubernetes addons in a comma-separated list.'}),NOWAIT,TAGS],
    [['Create a Kubernetes cluster with an existing SSH public key.','az aks create -g MyResourceGroup -n MyManagedCluster --ssh-key-value /path/to/publickey'],['Create a Kubernetes cluster with one node and generate SSH keys.','az aks create -g MyResourceGroup -n MyManagedCluster --node-count 1 --generate-ssh-keys']],v=>{
      const g=needGroup(v.rg,true);
      const loc=v.location?needLoc(v.location,'aks'):g.location;
      if(!/^[a-zA-Z0-9]([a-zA-Z0-9_-]{0,61}[a-zA-Z0-9])?$/.test(v.name))err(`--name cannot exceed 63 characters and can only contain letters, numbers, underscores (_) or dashes (-).`);
      const count=v.count==null?3:v.count;
      if(count<1||count>1000)err('--node-count must be between 1 and 1000');
      const vmSize=v.vmSize?sizeName(v.vmSize):'Standard_DS2_v2';
      if(!vmSize)arm('InvalidParameter',`The VM size of ${v.vmSize} is not allowed in your subscription in location '${loc}'.`);
      const version=v.version||AKS_DEFAULT;
      if(!AKS_VERSIONS.some(([x])=>x===version||x.startsWith(version+'.')))arm('K8sVersionNotSupported',`Managed cluster ${v.name} is on version ${version} which is not supported in this region. Please use [az aks get-versions] command to get the supported version list in this region. For more information, please check https://aka.ms/supported-version-list`);
      const ver=AKS_VERSIONS.find(([x])=>x===version||x.startsWith(version+'.'))[0];
      if(findRes('aks',g.name,v.name))arm('OperationNotAllowed',`Managed cluster ${v.name} already exists. Use "az aks update" to modify it.`);
      const warn=[];
      if(!v.noSsh&&!S.sshKeys){if(!v.genKeys)err('An RSA key file or key value must be supplied to SSH Key Value. You can use --generate-ssh-keys to let CLI generate one for you');S.sshKeys=true;warn.push("SSH key files '/home/user/.ssh/id_rsa' and '/home/user/.ssh/id_rsa.pub' have been generated under ~/.ssh to allow SSH access to the VM. If using machines without permanent storage, back up your keys to a safe location.")}
      checkQuota(loc,vmSize,count);
      const dns=`${v.name.slice(0,10)}-${g.name.slice(0,16)}-${curSub().slice(0,6)}`.replace(/[^a-zA-Z0-9-]/g,'');
      const nodeRg=`MC_${g.name}_${v.name}_${loc}`;
      const a=add({t:'aks',name:v.name,rg:g.name,location:loc,tags:tagsOf(v.tags),p:{count,vmSize,version:ver,tier:v.tier==='standard'?'Standard':v.tier==='premium'?'Premium':'Free',power:'Running',dnsPrefix:dns,fqdn:`${dns}-${hexs(8)}.hcp.${loc}.azmk8s.io`,nodeRg,uid:guid(),principal:guid()}});
      const mc=add({t:'group',name:nodeRg,location:loc,p:{managedBy:resId(a)},tags:{'aks-managed-cluster-name':v.name,'aks-managed-cluster-rg':g.name}});
      add({t:'vmss',name:`aks-nodepool1-${String(parseInt(a.p.uid.slice(0,6),16)%1e8).padStart(8,'1')}-vmss`,rg:mc.name,location:loc,p:{}});
      add({t:'lb',name:'kubernetes',rg:mc.name,location:loc,p:{}});
      add({t:'pip',name:guid(),rg:mc.name,location:loc,p:{ip:pubIp()}});
      add({t:'nsg',name:`aks-agentpool-${parseInt(a.p.uid.slice(0,6),16)%1e8}-nsg`,rg:mc.name,location:loc,p:{}});
      add({t:'vnet',name:`aks-vnet-${parseInt(a.p.uid.slice(0,6),16)%1e8}`,rg:mc.name,location:loc,p:{prefixes:['10.224.0.0/12'],subnets:[{name:'aks-subnet',prefix:'10.224.0.0/16',etag:guid()}],etag:guid(),guid:guid()}});
      stat('aksCreate');
      if(v.noWait){a.busy={state:'Creating',until:now()+90000,from:now()};return{warn}}
      return{warn,data:aksView(a)};
    });
  cmd('aks list','List managed Kubernetes clusters.',[RG(false)],[['List managed Kubernetes clusters.','az aks list -o table']],v=>{if(v.rg)needGroup(v.rg);return{data:resOf('aks',v.rg).map(aksView)}},{table:aksTable});
  cmd('aks show','Show the details for a managed Kubernetes cluster.',[NAME('Name of the managed cluster.'),RG()],[['Show the details for a managed Kubernetes cluster.','az aks show -g MyResourceGroup -n MyManagedCluster']],v=>({data:aksView(aksFind(v))}),{table:d=>aksTable([d])});
  cmd('aks get-credentials','Get access credentials for a managed Kubernetes cluster.',[NAME('Name of the managed cluster.'),RG(),A('admin',['--admin','-a'],{type:'bool',desc:'Get cluster administrator credentials. Default: cluster user credentials.'}),A('context',['--context'],{desc:'If specified, overwrite the default context name. The `--admin` parameter takes precedence over `--context`.'}),A('file',['--file','-f'],{def:'~/.kube/config',desc:'Kubernetes configuration file to update. Use "-" to print YAML to stdout instead.'}),A('overwrite',['--overwrite-existing'],{type:'bool',desc:'Overwrite any existing cluster entry with the same name.'})],
    [['Get access credentials for a managed Kubernetes cluster.','az aks get-credentials --resource-group MyResourceGroup --name MyManagedCluster']],v=>{
      const a=aksFind(v);
      if(busy(a)==='Creating')arm('OperationNotAllowed',`Managed cluster ${a.name} is still being created. Please wait for the operation to complete.`);
      const ctx=v.admin?`${a.name}-admin`:(v.context||a.name),user=`${v.admin?'clusterAdmin':'clusterUser'}_${a.rg}_${a.name}`;
      if(v.file==='-')return{text:yaml.dump({apiVersion:'v1',clusters:[{cluster:{'certificate-authority-data':'LS0tLS1CRUdJTi...',server:`https://${a.p.fqdn}:443`},name:a.name}],contexts:[{context:{cluster:a.name,user},name:ctx}],'current-context':ctx,kind:'Config',preferences:{},users:[{name:user,user:{'client-certificate-data':'LS0tLS1CRUdJTi...','client-key-data':'LS0tLS1CRUdJTi...',token:'REDACTED'}}]}).trimEnd()};
      S.merged=S.merged.filter(m=>m.context!==ctx);
      S.merged.push({context:ctx,cluster:a.name,id:a.p.uid,user,at:now()});
      stat('getCredentials');
      return{text:`Merged "${ctx}" as current context in /home/user/.kube/config`,kube:true};
    });
  cmd('aks scale','Scale the node pool in a managed Kubernetes cluster.',[NAME('Name of the managed cluster.'),RG(),A('count',['--node-count','-c'],{type:'int',req:true,desc:'Number of nodes in the Kubernetes node pool.'}),A('pool',['--nodepool-name'],{desc:'Node pool name, up to 12 alphanumeric characters.'}),NOWAIT],
    [['Scale the node pool in a managed Kubernetes cluster.','az aks scale -g MyResourceGroup -n MyManagedCluster --node-count 3']],v=>{
      const a=aksFind(v);aksBusy(a);
      if(v.pool&&v.pool!=='nodepool1')err(`Could not find node pool ${v.pool}. Valid node pool names: nodepool1`);
      if(a.p.power==='Stopped')arm('OperationNotAllowed',`Operation is not allowed: Cluster is in stopped state. Please start the cluster first.`);
      if(v.count<0||v.count>1000)err('--node-count must be between 0 and 1000');
      if(v.count===0)arm('InvalidParameter',`Node pool nodepool1 is a System mode pool and must have at least 1 node.`);
      if(v.count>a.p.count)checkQuota(a.location,a.p.vmSize,v.count-a.p.count);
      a.p.count=v.count;stat('aksScale');
      return v.noWait?{}:{data:aksView(a)};
    });
  cmd('aks stop','Stop a managed cluster.',[NAME('Name of the managed cluster.'),RG(),NOWAIT],[['Stop a managed cluster.','az aks stop -g MyResourceGroup -n MyManagedCluster']],v=>{const a=aksFind(v);aksBusy(a);a.p.power='Stopped';stat('aksStop');return{}},{long:'This can only be performed on Azure Virtual Machine Scale set backed clusters. Stopping a cluster stops the control plane and agent nodes entirely, while maintaining all object and cluster state. A cluster does not accrue charges while it is stopped.'});
  cmd('aks start','Start a previously stopped managed cluster.',[NAME('Name of the managed cluster.'),RG(),NOWAIT],[['Start a stopped cluster.','az aks start -g MyResourceGroup -n MyManagedCluster']],v=>{const a=aksFind(v);aksBusy(a);if(a.p.power==='Stopped')checkQuota(a.location,a.p.vmSize,a.p.count);a.p.power='Running';return{}});
  cmd('aks delete','Delete a managed Kubernetes cluster.',[NAME('Name of the managed cluster.'),RG(),YES,NOWAIT],[['Delete a managed Kubernetes cluster.','az aks delete -g MyResourceGroup -n MyManagedCluster']],v=>{
    const a=aksFind(v);
    const go=()=>{aksBusy(a);stat('aksDelete');if(v.noWait){a.busy={state:'Deleting',until:now()+60000,from:now()};return{}}removeTree(a);return{}};
    return v.yes?go():confirm(go);
  });
  cmd('aks get-versions','Get the versions available for creating a managed Kubernetes cluster.',[A('location',['--location','-l'],{req:true,cfg:'location',desc:'Location. Values from: `az account list-locations`.'})],[['Get the versions available for creating a managed Kubernetes cluster.','az aks get-versions --location westus2 -o table']],v=>{
    needLoc(v.location,'aks');
    return{data:{values:AKS_VERSIONS.map(([ver,up])=>({capabilities:{supportPlan:['KubernetesOfficial','AKSLongTermSupport']},isDefault:ver===AKS_DEFAULT?true:null,isPreview:null,patchVersions:{[ver]:{upgrades:up}},version:ver.split('.').slice(0,2).join('.')}))}};
  },{table:d=>(d.values||[]).map(x=>{const[pv,info]=Object.entries(x.patchVersions)[0];return{KubernetesVersion:pv,Upgrades:info.upgrades.length?info.upgrades.join(', '):'None available',SupportPlan:'KubernetesOfficial, AKSLongTermSupport'}})});

  // ---------- Comandos: RBAC y Entra ID ----------
  function findPrincipal(a){
    const u=USERS.find(u=>lc(u.upn)===lc(a)||u.id===a||lc(u.upn.split('@')[0])===lc(a));
    if(!u)err(`Cannot find user or service principal in graph database for '${a}'. If the assignee is an appId, make sure the corresponding service principal is created with 'az ad sp create --id ${a}'.\ncloudlab: usuarios del directorio simulado: ${USERS.map(u=>u.upn).join(', ')}`);
    return u;
  }
  function checkScope(scope){
    const m=String(scope).match(/^\/subscriptions\/([^/]+)(\/resourceGroups\/([^/]+)(\/providers\/([^/]+\/[^/]+)\/([^/]+))?)?\/?$/i);
    if(!m)arm('MissingSubscription','The request did not have a subscription or a valid tenant level resource provider.');
    if(!S.subs.some(s=>s.id===m[1]))arm('InvalidSubscriptionId',`The provided subscription identifier '${m[1]}' is malformed or invalid.`);
    const prev=S.cur;S.cur=m[1];
    try{
      if(m[3]){const g=needGroup(m[3]);if(m[5]){const t=Object.keys(TYPES).find(k=>lc(TYPES[k])===lc(m[5]));if(!t||!findRes(t,g.name,m[6]))arm('ResourceNotFound',`The Resource '${m[5]}/${m[6]}' under resource group '${m[3]}' was not found. For more details please go to https://aka.ms/ARMResourceNotFoundFix`,3);return`/subscriptions/${m[1]}/resourceGroups/${g.name}/providers/${TYPES[t]}/${findRes(t,g.name,m[6]).name}`}return`/subscriptions/${m[1]}/resourceGroups/${g.name}`}
      return`/subscriptions/${m[1]}`;
    }finally{S.cur=prev}
  }
  const roleName=r=>Object.keys(ROLES).find(k=>lc(k)===lc(r)||ROLES[k]===r);
  cmd('role assignment create','Create a new role assignment for a user, group, or service principal.',[A('role',['--role'],{req:true,desc:'Role name or id.'}),A('scope',['--scope'],{req:true,desc:'Scope at which the role assignment or definition applies to, e.g., /subscriptions/0b1f6471-1bf0-4dda-aec3-111122223333, /subscriptions/0b1f6471-1bf0-4dda-aec3-111122223333/resourceGroups/myGroup, or /subscriptions/0b1f6471-1bf0-4dda-aec3-111122223333/resourceGroups/myGroup/providers/Microsoft.Compute/virtualMachines/myVM.'}),A('assignee',['--assignee'],{desc:'Represent a user, group, or service principal. supported format: object id, user sign-in name, or service principal name.'}),A('objectId',['--assignee-object-id'],{desc:"The assignee's object ID (also known as principal ID)."}),A('ptype',['--assignee-principal-type'],{choices:['ForeignGroup','Group','ServicePrincipal','User'],desc:'Use with --assignee-object-id to avoid errors caused by propagation latency in Microsoft Graph.'}),A('description',['--description'],{desc:'Description of role assignment.'})],
    [['Create role assignment to grant the specified assignee the Reader role on a resource group.','az role assignment create --assignee ana.garcia@cloudlabdemo.onmicrosoft.com --role Reader --scope /subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/MyResourceGroup']],v=>{
      if(!v.assignee&&!v.objectId)err('usage error: --assignee STRING | --assignee-object-id GUID',2);
      const role=roleName(v.role);
      if(!role)err(`Role '${v.role}' doesn't exist.`);
      const scope=checkScope(v.scope);
      const u=findPrincipal(v.assignee||v.objectId);
      if(S.roles.some(r=>lc(r.scope)===lc(scope)&&r.role===role&&r.principal===u.id))arm('RoleAssignmentExists','The role assignment already exists.',1);
      const r={id:guid(),scope,role,principal:u.id,created:now()};
      S.roles.push(r);stat('roleCreate');
      return{data:roleView(r)};
    });
  const roleTable=d=>d.map(r=>({Principal:r.principalName,Role:r.roleDefinitionName,Scope:r.scope}));
  cmd('role assignment list','List role assignments.',[A('all',['--all'],{type:'bool',desc:'Show all assignments under the current subscription.'}),A('assignee',['--assignee'],{desc:'Represent a user, group, or service principal. supported format: object id, user sign-in name, or service principal name.'}),A('role',['--role'],{desc:'Role name or id.'}),RG(false),A('scope',['--scope'],{desc:'Scope at which the role assignment or definition applies to.'}),A('inherited',['--include-inherited'],{type:'bool',desc:'Include assignments applied on parent scopes.'})],
    [['List role assignments at the subscription scope.','az role assignment list -o table'],['List all role assignments in the subscription.','az role assignment list --all -o table']],v=>{
      const subScope=`/subscriptions/${curSub()}`;
      let rs=S.roles.filter(r=>lc(r.scope).startsWith(lc(subScope)));
      const u=v.assignee&&findPrincipal(v.assignee);
      if(u)rs=rs.filter(r=>r.principal===u.id);
      if(v.role){const role=roleName(v.role);if(!role)err(`Role '${v.role}' doesn't exist.`);rs=rs.filter(r=>r.role===role)}
      if(v.scope||v.rg){const sc=v.scope?checkScope(v.scope):`${subScope}/resourceGroups/${needGroup(v.rg).name}`;rs=rs.filter(r=>lc(r.scope)===lc(sc)||(v.inherited&&lc(sc).startsWith(lc(r.scope))))}
      else if(!v.all&&!u)rs=rs.filter(r=>lc(r.scope)===lc(subScope));
      return{data:rs.map(roleView)};
    },{table:roleTable});
  cmd('role assignment delete','Delete role assignments.',[A('assignee',['--assignee'],{desc:'Represent a user, group, or service principal.'}),A('role',['--role'],{desc:'Role name or id.'}),RG(false),A('scope',['--scope'],{desc:'Scope at which the role assignment applies to.'}),A('ids',['--ids'],{type:'list',desc:'Space-separated role assignment ids.'}),YES],
    [['Delete all role assignments with "Reader" role at the subscription scope.','az role assignment delete --role Reader --scope /subscriptions/00000000-0000-0000-0000-000000000000']],v=>{
      let rs=S.roles.filter(r=>r.scope.startsWith(`/subscriptions/${curSub()}`));
      if(v.ids)rs=rs.filter(r=>v.ids.some(i=>lc(i).endsWith(r.id)));
      if(v.assignee){const u=findPrincipal(v.assignee);rs=rs.filter(r=>r.principal===u.id)}
      if(v.role){const role=roleName(v.role);rs=rs.filter(r=>r.role===role)}
      const sc=v.scope?checkScope(v.scope):v.rg?`/subscriptions/${curSub()}/resourceGroups/${needGroup(v.rg).name}`:`/subscriptions/${curSub()}`;
      if(!v.ids)rs=rs.filter(r=>lc(r.scope)===lc(sc));
      if(!rs.length)err('No matched assignments were found to delete');
      if(rs.some(r=>r.principal===USERS[0].id&&r.role==='Owner'&&r.scope.split('/').length===3))err('cloudlab: no puedes quitarte el rol Owner de la suscripción en este simulador (perderías el acceso a todo).');
      S.roles=S.roles.filter(r=>!rs.includes(r));return{};
    });
  cmd('role definition list','List role definitions.',[A('name',['--name','-n'],{desc:'A role\'s name, can be used to show details of a specific role definition.'}),A('custom',['--custom-role-only'],{type:'tbool',desc:'Custom roles only (vs. build-in ones).'})],[['List all built-in roles.','az role definition list --query "[].roleName" -o tsv']],v=>{
    let d=Object.entries(ROLES).map(([n,id])=>({assignableScopes:['/'],description:{Owner:'Grants full access to manage all resources, including the ability to assign roles in Azure RBAC.',Contributor:'Grants full access to manage all resources, but does not allow you to assign roles in Azure RBAC, manage assignments in Azure Blueprints, or share image galleries.',Reader:'View all resources, but does not allow you to make any changes.'}[n]||`Lets you manage ${n.replace(/ (Contributor|Reader|Role)$/,'').toLowerCase()} resources.`,id:`/subscriptions/${curSub()}/providers/Microsoft.Authorization/roleDefinitions/${id}`,name:id,permissions:[{actions:n==='Reader'?['*/read']:['*'],dataActions:[],notActions:n==='Contributor'?['Microsoft.Authorization/*/Delete','Microsoft.Authorization/*/Write']:[],notDataActions:[]}],roleName:n,roleType:'BuiltInRole',type:'Microsoft.Authorization/roleDefinitions'}));
    if(v.name)d=d.filter(r=>lc(r.roleName)===lc(v.name));
    if(v.custom)d=[];
    return{data:d};
  },{table:d=>d.map(r=>({Name:r.roleName,Type:r.roleType,Description:r.description}))});
  const userView=u=>({businessPhones:[],displayName:u.displayName,givenName:u.givenName,id:u.id,jobTitle:null,mail:null,mobilePhone:null,officeLocation:null,preferredLanguage:null,surname:u.surname,userPrincipalName:u.upn});
  cmd('ad user list','List users.',[A('displayName',['--display-name'],{desc:'Object\'s display name or its prefix.'}),A('upn',['--upn'],{desc:'User principal name.'})],[['List the sign-in names of all users.','az ad user list --query "[].userPrincipalName" -o tsv']],v=>({data:USERS.filter(u=>(!v.displayName||u.displayName.startsWith(v.displayName))&&(!v.upn||lc(u.upn)===lc(v.upn))).map(userView)}),{table:d=>d.map(u=>({DisplayName:u.displayName,GivenName:u.givenName,Surname:u.surname,UserPrincipalName:u.userPrincipalName,Id:u.id}))});
  cmd('ad user show','Get the details of a user.',[A('id',['--id'],{req:true,desc:'User\'s object id or principal name.'})],[['Show a user.','az ad user show --id ana.garcia@cloudlabdemo.onmicrosoft.com']],v=>{const u=USERS.find(u=>u.id===v.id||lc(u.upn)===lc(v.id));if(!u)err(`Resource '${v.id}' does not exist or one of its queried reference-property objects are not present.`,3);return{data:userView(u)}});
  cmd('resource list','List resources.',[RG(false),A('type',['--resource-type'],{desc:'The resource type (Ex: \'resC\'). Can also accept namespace/type format (Ex: \'Microsoft.Provider/resC\').'}),A('location',['--location','-l'],{desc:'Location.'}),A('tag',['--tag'],{desc:'A single tag in \'key[=value]\' format.'})],[['List all the resources in a resource group.','az resource list -g MyResourceGroup -o table']],v=>{
    if(v.rg)needGroup(v.rg);
    let rs=S.res.filter(r=>r.t!=='group'&&inSub(r)&&(!v.rg||lc(r.rg)===lc(v.rg)));
    if(v.type)rs=rs.filter(r=>lc(TYPES[r.t]).endsWith(lc(v.type)));
    if(v.location)rs=rs.filter(r=>r.location===normLoc(v.location));
    return{data:rs.map(genericView)};
  },{table:d=>d.map(r=>({Name:r.name,ResourceGroup:r.resourceGroup,Location:r.location,Type:r.type,Status:''}))});
  cmd('find','I\'m an AI robot, my advice is based on our Azure documentation as well as the usage patterns of Azure CLI and Azure ARM users. Using me improves Azure products and documentation.',[],[['Give me any Azure CLI group and I\'ll show the most popular commands within the group.','az find "az storage"'],['Give me any Azure CLI command and I\'ll show the most popular parameters and subcommands.','az find "az monitor activity-log list"']],v=>({text:findText(v.__pos||[])}),{login:false,positional:true});
  cmd('version','Show the versions of Azure CLI modules and extensions in JSON format by default or format configured by --output.',[],[['Show the versions.','az version']],()=>({data:{'azure-cli':CLI_VERSION,'azure-cli-core':CLI_VERSION,'azure-cli-telemetry':'1.1.0',extensions:{}}}),{login:false});
  function findText(q){
    const s=q.join(' ').replace(/^az\s+/,'').trim();
    if(!s)err('the following arguments are required: <CLI_TERM>',2);
    const keys=Object.keys(C).filter(k=>k===s||k.startsWith(s+' ')||(s.split(' ').every(w=>k.includes(w))));
    const ex=keys.flatMap(k=>C[k].ex||[]).slice(0,4);
    if(!ex.length)return`Sorry, I don't have any examples for "${s}". cloudlab: prueba con az find "vm", az find "storage account" o az find "aks".`;
    return`Finding examples...\n\nHere are the most common ways to use [${s}]:\n\n${ex.map(([d,x])=>`${d}\n${x}\n`).join('\n')}\nPlease let us know how we are doing: https://aka.ms/clihats\nand let us know if you're interested in trying out our newest features: https://aka.ms/CLIUXstudy`;
  }

  // ---------- Mini shell (variables, $(...), tuberías, redirecciones) ----------
  const SHELL_CMDS=['az','kubectl','k','clear','help','history','ls','cat','rm','echo','export','unset','env','lab','grep','wc','head','tail','pwd','whoami','date','touch','nano','vi','vim','jq'];
  function expand(arg,subs){
    return arg.replace(/\u0002(\d+)\u0002/g,(_,i)=>subs[+i]).replace(/\$\{(\w+)\}|\$(\w+)/g,(_,a,b)=>S.vars[a||b]??'').replace(/\u0001/g,'$');
  }
  function builtin(args,stdin,subs){
    const [c,...rest]=args;
    if(/^[A-Za-z_]\w*=/.test(c)&&args.every(a=>/^[A-Za-z_]\w*=/.test(a))){for(const a of args){const i=a.indexOf('=');S.vars[a.slice(0,i)]=a.slice(i+1)}return''}
    switch(c){
      case'az':return az(rest);
      case'kubectl':case'k':
        if(!opts.kubectl)return{out:'cloudlab: kubectl no está disponible en esta terminal.',code:1,err:true};
        stat('kubectl');
        return opts.kubectl(args,stdin,bridge());
      case'help':return shellHelp();
      case'export':for(const a of rest){const i=a.indexOf('=');if(i>0)S.vars[a.slice(0,i)]=a.slice(i+1)}return'';
      case'unset':for(const a of rest)delete S.vars[a];return'';
      case'env':return Object.entries({HOME:'/home/user',USER:'user',SHELL:'/bin/bash',AZURE_CONFIG_DIR:'/home/user/.azure',...S.vars}).map(([k,v])=>`${k}=${v}`).join('\n');
      case'echo':return rest.filter(x=>x!=='-n'&&x!=='-e').join(' ');
      case'ls':{const f=Object.keys(S.files).sort();return rest.includes('-l')||rest.includes('-la')?f.map(n=>`-rw-r--r-- 1 user user ${pad(S.files[n].length,5)} ${n}`).join('\n'):f.join('  ')}
      case'cat':{if(!rest.length)return stdin??'';return rest.map(f=>f in S.files?S.files[f].replace(/\n$/,''):fail(`cat: ${f}: No such file or directory`)).join('\n')}
      case'rm':{if(!rest.length)fail('rm: missing operand');for(const f of rest.filter(x=>!x.startsWith('-'))){if(!(f in S.files))fail(`rm: cannot remove '${f}': No such file or directory`);delete S.files[f]}return''}
      case'touch':{for(const f of rest)S.files[f]=S.files[f]||'';return''}
      case'pwd':return'/home/user';
      case'whoami':return'user';
      case'date':return new Date(now()).toString();
      case'clear':return{out:'',clear:true};
      case'history':return S.history.map((h,i)=>`${pad(i+1,5)} ${h}`).join('\n');
      case'nano':case'vi':case'vim':return`cloudlab: los editores no están disponibles. Crea un fichero con:\n  cat <<EOF > ${rest[0]||'fichero.txt'}\n  ...\n  EOF`;
      case'jq':return`cloudlab: jq no está instalado aquí. Usa --query (JMESPath), que viene con az: az vm list --query "[].name" -o tsv`;
      case'grep':{
        const fl=rest.filter(x=>/^-[a-zA-Z]+$/.test(x)).join('');
        const pat=rest.find(x=>!/^-[a-zA-Z]+$/.test(x));
        if(pat==null)fail('Usage: grep [OPTION]... PATTERNS [FILE]...');
        let re;try{re=new RegExp(pat,fl.includes('i')?'i':'')}catch{re=new RegExp(pat.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),fl.includes('i')?'i':'')}
        const lines=String(stdin??'').split('\n').filter(l=>fl.includes('v')?!re.test(l):re.test(l));
        if(fl.includes('c'))return String(lines.length);
        return lines.length?lines.join('\n'):{out:'',code:1};
      }
      case'wc':{const s=String(stdin??'');const lines=s?s.split('\n').length:0;return rest.includes('-l')?String(lines):`${pad(lines,7)} ${pad(s.split(/\s+/).filter(Boolean).length,7)} ${s.length}`}
      case'head':case'tail':{const n=+(rest.find(x=>/^-?\d+$/.test(x))||'10').replace('-','')||+(rest[rest.indexOf('-n')+1]||10);const l=String(stdin??'').split('\n');return(c==='head'?l.slice(0,n):l.slice(-n)).join('\n')}
      case'lab':{
        if(rest[0]==='reset'){fresh();return{out:'cloudlab: Azure reiniciado. Vuelves a tener dos suscripciones vacías y la sesión cerrada (empieza con az login).',reset:true}}
        if(rest[0]==='status'||!rest[0])return`cloudlab: Azure simulado (Azure CLI ${CLI_VERSION})\nCreado: ${new Date(S.createdAt).toLocaleString('es')}\nSesión: ${S.loggedIn?USERS[0].upn:'sin iniciar'} · Suscripción: ${sub().name}\nGrupos: ${S.res.filter(r=>r.t==='group').length} · Recursos: ${S.res.filter(r=>r.t!=='group').length}\nEl estado se guarda en este navegador y se borra tras 48 h sin uso.\nComandos: lab status | lab reset`;
        fail(`lab: subcomando desconocido "${rest[0]}". Usa: lab status | lab reset`);
      }
    }
    if(C[c]||GROUPS[c]||ROOT_EXTRA[c]||(REAL['']||[]).includes(c))fail(`bash: ${c}: command not found\ncloudlab: ¿quisiste decir "az ${c}"?`,127);
    if(c==='minikube')fail(`bash: minikube: command not found\ncloudlab: minikube está en la terminal de Kubernetes. Aquí puedes usar kubectl con los clústeres AKS que conectes con az aks get-credentials.`,127);
    const s=similar(c,SHELL_CMDS);
    fail(`bash: ${c}: command not found${s.length?`\ncloudlab: ¿quisiste decir "${s[0]}"?`:''}`,127);
  }
  function shellHelp(){
    return`Terminal de Cloud Lab: Azure CLI ${CLI_VERSION} simulada, como Azure Cloud Shell.\nNada se crea de verdad ni cuesta dinero: el simulador imita el comportamiento y los errores reales.\n\n  az login              Inicia sesión (simulada) y elige suscripción\n  az --help             Grupos de comandos; az vm --help, az vm create --help...\n  az find "vm"          Ejemplos de uso de un grupo o comando\n  -o table|json|tsv     Formato de salida; --query "[].name" filtra con JMESPath\n  RG=mi-grupo           Variables de bash: az group show -n $RG\n  $(az ... -o tsv)      Sustitución de comandos: --scope $(az group show -n $RG --query id -o tsv)\n  kubectl ...           Tras az aks get-credentials, maneja el clúster AKS (compartido con la terminal de Kubernetes)\n  grep, wc, head        Filtra la salida con tuberías: az vm list-sizes -l eastus -o table | grep B1\n  history, clear        Historial y limpiar la pantalla\n  lab status|reset      Estado del laboratorio o empezar de cero\n\nAtajos: Tab autocompleta (dos veces muestra opciones) · ↑/↓ historial · Ctrl+C cancela · Ctrl+L limpia`;
  }
  // Convierte una respuesta del comando az en salida de terminal.
  function render(r){
    const parts=[];
    if(r.text!=null&&r.text!=='')parts.push({out:r.text});
    if(r.warn&&r.warn.length&&!(r.G&&r.G.onlyErrors))parts.push({out:r.warn.map(w=>w.startsWith('cloudlab:')?w:'WARNING: '+w).join('\n'),warn:true});
    if(r.data!==undefined){const out=format(r,r.G||{});if(out)parts.push({out})}
    return parts;
  }
  // Ejecuta una cadena ya tokenizada; devuelve {outs, code, clear, reset, ask}.
  function exec(chains,heredoc,subs,state){
    const outs=state.outs;
    for(let ci=state.ci||0;ci<chains.length;ci++){
      const ch=chains[ci];
      if(ch.sep==='&&'&&state.code!==0)continue;
      if(ch.sep==='||'&&state.code===0)continue;
      let stdin=heredoc;let lastOut={out:'',code:0};
      for(let i=0;i<ch.pipeline.length;i++){
        const p=ch.pipeline[i];
        const args=p.args.map(a=>{const unquotedVar=/^\$\w+$|^\$\{\w+\}$/.test(a);const x=expand(a,subs);return unquotedVar&&x===''?null:x}).filter(a=>a!==null);
        let r;
        try{r=args.length?builtin(args,stdin,subs):''}
        catch(e){
          if(e instanceof Ask){state.ci=ci+1;state.redirect=p.redirect;return{ask:e}}
          if(e instanceof AzError)r={out:e.message,code:e.code,err:true};
          else if(e&&e.code!=null&&e.message&&!(e instanceof TypeError)&&!(e instanceof ReferenceError))r={out:e.message,code:e.code,err:true};
          else{if(typeof console!=='undefined')console.error(e);r={out:`cloudlab: error interno del simulador (${e.message}). Prueba otra forma del comando o usa lab reset.`,code:1,err:true}}
        }
        let res;
        if(typeof r==='string')res={parts:r?[{out:r}]:[],code:0};
        else if(r&&(r.data!==undefined||r.text!==undefined||r.warn||r.G)){
          if(r.ask){outs.push(...render({...r,data:undefined}));state.ci=ci+1;state.redirect=p.redirect;return{ask:r.ask}}
          let parts;
          try{parts=render(r)}catch(e){if(e instanceof AzError)parts=[{out:e.message,err:true}],r.code=e.code;else throw e}
          if(r.kube)state.kube=true;
          res={parts,code:r.code||0};
        }
        else res={parts:r&&r.out?[{out:r.out,err:r.err}]:[],code:(r&&r.code)||0,clear:r&&r.clear,reset:r&&r.reset};
        if(res.clear)state.clear=true;if(res.reset)state.reset=true;
        const body=res.parts.filter(x=>!x.err&&!x.warn).map(x=>x.out).join('\n');
        const side=res.parts.filter(x=>x.err||x.warn);
        if(p.redirect&&!(res.code&&side.some(x=>x.err))){
          S.files[p.redirect.file]=(p.redirect.append?(S.files[p.redirect.file]||''):'')+(body?body+'\n':'');
          outs.push(...side);lastOut={out:'',code:res.code};
        }else if(i<ch.pipeline.length-1){outs.push(...side);lastOut={out:body,code:res.code}}
        else{outs.push(...res.parts);lastOut={out:'',code:res.code}}
        stdin=lastOut.out;heredoc=undefined;
      }
      state.code=lastOut.code;
    }
    return{};
  }
  // Sustituye $(...) (fuera de comillas simples) por marcadores y protege los $ entre comillas simples.
  function prepare(line){
    const subs=[];let out='',q=null;
    for(let i=0;i<line.length;i++){
      const c=line[i];
      if(q==="'"){if(c==="'")q=null;out+=c==='$'?'\u0001':c;continue}
      if(c==="'"&&!q){q="'";out+=c;continue}
      if(c==='"'){q=q==='"'?null:'"';out+=c;continue}
      if(c==='$'&&line[i+1]==='('){
        let depth=1,j=i+2;
        while(j<line.length&&depth){if(line[j]==='(')depth++;else if(line[j]===')')depth--;j++}
        if(depth)throw new AzError('bash: syntax error: unexpected end of file',2);
        const inner=line.slice(i+2,j-1);
        const r=runInner(inner);
        subs.push(r);out+=`\u0002${subs.length-1}\u0002`;i=j-1;continue;
      }
      out+=c;
    }
    return{line:out,subs};
  }
  function runInner(inner){
    const p=prepare(inner);
    const chains=K.parseLine(p.line);
    const state={outs:[],code:0};
    const r=exec(chains,undefined,p.subs,state);
    if(r.ask){pending=null;return''}
    innerErrs.push(...state.outs.filter(x=>x.err||x.warn));
    return state.outs.filter(x=>!x.err&&!x.warn).map(x=>x.out).join('\n').replace(/\n+$/,'');
  }
  let innerErrs=[];
  function finish(state){
    const parts=state.outs;
    S.savedAt=now();
    const res={out:parts.map(o=>o.out).join('\n'),parts,code:state.code,clear:state.clear,reset:state.reset,kube:state.kube};
    return res;
  }
  function run(line,heredoc){
    const trimmed=line.trim();
    if(!trimmed)return{out:'',parts:[],code:0};
    if(!S.history.length||S.history[S.history.length-1]!==trimmed)S.history.push(trimmed);
    if(S.history.length>200)S.history.shift();
    pending=null;innerErrs=[];
    settle();
    let chains,subs;
    try{const p=prepare(trimmed);chains=K.parseLine(p.line);subs=p.subs}
    catch(e){return{out:e.message,parts:[{out:e.message,err:true}],code:2}}
    const state={outs:[...innerErrs],code:0,chains,subs};
    const r=exec(chains,heredoc,subs,state);
    if(r.ask){pending={ask:r.ask,state};const out=finish(state);out.ask={text:r.ask.text,secret:r.ask.secret};return out}
    return finish(state);
  }
  // Respuesta del usuario a una pregunta (y/n, contraseña, suscripción).
  function answer(text){
    if(!pending)return{out:'',parts:[],code:0};
    const{ask,state}=pending;pending=null;
    state.outs=[];
    let r;
    try{r=ask.cont(text)}
    catch(e){
      if(e instanceof Ask){pending={ask:e,state};const out=finish(state);out.ask={text:e.text,secret:e.secret};return out}
      if(e instanceof AzError){state.outs.push({out:e.message,err:true});state.code=e.code;return finish(state)}
      throw e;
    }
    r=r||{};
    if(r.ask){state.outs.push(...render({...r,data:undefined}));pending={ask:r.ask,state};const out=finish(state);out.ask={text:r.ask.text,secret:r.ask.secret};return out}
    const prevG=state.G;
    try{state.outs.push(...render({...r,G:r.G||prevG||{}}))}catch(e){if(e instanceof AzError){state.outs.push({out:e.message,err:true});state.code=e.code}else throw e}
    if(r.kube)state.kube=true;
    if(!state.outs.some(x=>x.err))state.code=0;
    // Continúa con el resto de la línea (p. ej. "az group delete -n x && az group list").
    if(state.chains&&state.ci<state.chains.length){const rr=exec(state.chains,undefined,state.subs,state);if(rr.ask){pending={ask:rr.ask,state};const out=finish(state);out.ask={text:rr.ask.text,secret:rr.ask.secret};return out}}
    return finish(state);
  }
  function cancel(){pending=null}

  // ---------- Autocompletado ----------
  function complete(line){
    let toks;
    try{toks=K.tokenize(line).filter(t=>typeof t==='string')}catch{return{candidates:[],word:''}}
    const endsSpace=/\s$/.test(line)||line==='';
    const word=endsSpace?'':(toks.pop()||'');
    const segStart=Math.max(line.lastIndexOf('|'),line.lastIndexOf('&&')+1,line.lastIndexOf(';'),line.lastIndexOf('$(')+1);
    if(segStart>0){try{toks=K.tokenize(line.slice(segStart+1)).filter(t=>typeof t==='string');if(!endsSpace)toks.pop()}catch{}}
    const seg=(segStart>0?line.slice(segStart+1):line).replace(/^\s+/,'');
    if(/^(kubectl|k)\s/.test(seg))return opts.kubectlComplete?opts.kubectlComplete(seg):{candidates:[],word};
    if(word.startsWith('$')&&!word.startsWith('$('))return{candidates:Object.keys(S.vars).map(k=>'$'+k).filter(c=>c.startsWith(word)).sort(),word};
    const cands=candidates(toks,word);
    const uniq=[...new Set(cands)].filter(c=>c.startsWith(word)).sort();
    return{candidates:uniq,word};
  }
  function candidates(toks,word){
    if(!toks.length)return SHELL_CMDS;
    const c0=toks[0];
    if(['cat','rm','ls'].includes(c0))return Object.keys(S.files);
    if(c0==='lab')return toks.length===1?['status','reset']:[];
    if(c0!=='az')return[];
    let prefix='',key=null,prev=null;
    const seen={};
    for(const a of toks.slice(1)){
      if(key){
        if(isOpt(a)){prev=a.includes('=')?null:a;const[o,val]=a.split('=');if(val!=null)seen[o]=val;continue}
        if(prev){seen[prev]=a;prev=null}
        continue;
      }
      const cand=prefix?`${prefix} ${a}`:a;
      if(C[cand])key=cand;else if(GROUPS[cand]!=null)prefix=cand;else return[];
    }
    if(!key){
      if(word.startsWith('-'))return prefix?['--help']:['--help','--version'];
      const{subs,cmds}=children(prefix);return[...subs,...cmds].map(last);
    }
    const spec=[...C[key].args,...GLOBAL];
    const get=(...os)=>{for(const o of os)if(seen[o]!=null)return seen[o];return null};
    const rg=get('--resource-group','-g')||S.defaults.group;
    if(prev){const a=spec.find(x=>x.opts.includes(prev));if(a&&a.type!=='bool')return values(key,a,rg,get)}
    if(word.startsWith('-'))return spec.map(a=>a.opts.find(o=>o.startsWith('--'))||a.opts[0]);
    return[];
  }
  function values(key,a,rg,get){
    const names=t=>resOf(t,rg).map(r=>r.name);
    if(a.choices)return a.choices;
    switch(a.dest){
      case'rg':return groups().map(g=>g.name);
      case'location':return REGIONS.map(r=>r[0]);
      case'image':return Object.keys(IMAGES);
      case'size':case'vmSize':return Object.keys(SIZES);
      case'plan':return names('plan');
      case'vnet':return names('vnet');
      case'subnet':{const v=findRes('vnet',rg,get('--vnet-name')||'');return v?v.p.subnets.map(s=>s.name):[]}
      case'role':return Object.keys(ROLES).map(r=>/\s/.test(r)?`"${r}"`:r);
      case'assignee':return USERS.map(u=>u.upn);
      case'scope':return[`/subscriptions/${curSub()}`,...groups().map(g=>`/subscriptions/${curSub()}/resourceGroups/${g.name}`)];
      case'runtime':return RUNTIMES.linux;
      case'name':{
        if(key==='account set'||key==='account show')return S.subs.map(s=>s.id);
        if(key.startsWith('group'))return groups().map(g=>g.name);
        const t=key.startsWith('vm ')?'vm':key.startsWith('storage')?'storage':key.startsWith('network vnet subnet')?null:key.startsWith('network vnet')?'vnet':key.startsWith('appservice plan')?'plan':key.startsWith('webapp')?'webapp':key.startsWith('aks')?'aks':null;
        if(key.startsWith('network vnet subnet')){const v=findRes('vnet',rg,get('--vnet-name')||'');return v?v.p.subnets.map(s=>s.name):[]}
        return t&&!key.endsWith('create')?names(t):[];
      }
    }
    return[];
  }

  // ---------- Puente con la terminal de Kubernetes ----------
  function bridge(){
    const clusters=S.res.filter(r=>r.t==='aks').map(a=>({name:a.name,id:a.p.uid,rg:a.rg,location:a.location,nodeCount:a.p.count,version:a.p.version,vmSize:a.p.vmSize,fqdn:a.p.fqdn,power:busy(a)==='Creating'?'Creating':a.p.power,created:a.created}));
    for(const g of S.gone)if(!clusters.some(c=>c.name===g.name))clusters.push({name:g.name,id:g.id,fqdn:g.fqdn,deleted:true});
    return{clusters,merged:S.merged.filter(m=>m.cluster).map(m=>({context:m.context,cluster:m.cluster,user:m.user,at:m.at}))};
  }

  // ---------- Persistencia ----------
  const TTL=48*3600*1000;
  function load(saved){
    if(saved&&saved.v===1&&now()-saved.savedAt<TTL){S=clone(saved);S.history=S.history||[];S.files=S.files||{};S.vars=S.vars||{};S.stats=S.stats||{};S.gone=S.gone||[];S.merged=S.merged||[];S.cur=null;return true}
    fresh();return false;
  }
  const restored=load(opts.saved);
  settle();

  return{
    run,answer,cancel,complete,bridge,
    get state(){return S},
    get pending(){return pending?{text:pending.ask.text,secret:pending.ask.secret}:null},
    restored,
    serialize:()=>{const o=clone(S);delete o.cur;return o},
    view:{groupView,vmView,storageView,vnetView,planView,siteView,aksView,roleView,resId,busy,usage:coreUsage,powerText,disp},
    ttlHours:TTL/3600000,
    expiresAt:()=>S.savedAt+TTL,
    VERSION:CLI_VERSION,
    tick(){settle()},
    users:USERS,
  };
}

const api={create,VERSION:CLI_VERSION,jmespath:JP};
if(typeof module==='object'&&module.exports)module.exports=api;
else root.AzSim=api;
})(typeof globalThis!=='undefined'?globalThis:this);
