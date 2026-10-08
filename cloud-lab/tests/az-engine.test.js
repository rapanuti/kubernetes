// Pruebas de escenarios del motor de Azure CLI (y de su puente con Kubernetes) con un reloj simulado.
// Ejecuta: node cloud-lab/tests/az-engine.test.js
'use strict';
const assert=require('assert/strict');
const path=require('path');
const D=path.join(__dirname,'..','dist');
const yaml=require(path.join(D,'vendor/js-yaml.js'));
const K8sSim=require(path.join(D,'lab/k8s-engine.js'));
const AzSim=require(path.join(D,'lab/az-engine.js'));

let failed=0,passed=0;
function test(name,fn){
  try{fn();passed++;console.log(`  ✓ ${name}`)}
  catch(e){failed++;console.log(`  ✗ ${name}\n    ${String(e.stack||e).split('\n').slice(0,4).join('\n    ')}`)}
}
// Entorno: reloj simulado, estado de Kubernetes compartido y una función run que acepta respuestas a preguntas.
function env(){
  const clock={t:Date.parse('2026-10-07T10:00:00Z')};
  const now=()=>clock.t;
  let k8sSaved=null;
  const k8s=bridge=>{const k=K8sSim.create({yaml,now,saved:k8sSaved,aks:bridge});k.syncAks(bridge);return k};
  const az=AzSim.create({yaml,now,kubectl:(args,stdin,bridge)=>{const k=k8s(bridge);const r=k.exec(args,stdin);k8sSaved=k.serialize();return r},kubectlComplete:line=>k8s(az.bridge()).complete(line)});
  const run=(line,...answers)=>{let r=az.run(line);for(const a of answers){assert.ok(r.ask,`se esperaba una pregunta antes de responder "${a}" en: ${line}\n${r.out}`);r=az.answer(a)}clock.t+=1000;return r};
  const ok=(line,...a)=>{const r=run(line,...a);assert.equal(r.code,0,`${line}\n${r.out}`);return r};
  const login=()=>{const r=run('az login','');assert.equal(r.code,0)};
  const json=(line)=>JSON.parse(ok(line).out);
  return{clock,az,run,ok,login,json,k8s:()=>k8s(az.bridge()),k8sSaved:()=>k8sSaved};
}

console.log('Sesión y suscripciones');
test('sin az login los comandos piden iniciar sesión',()=>{
  const{run}=env();
  const r=run('az group list');
  assert.equal(r.code,1);
  assert.equal(r.out,"ERROR: Please run 'az login' to setup account.");
});
test('az login pregunta la suscripción y az account set la cambia',()=>{
  const{az,run,ok,json}=env();
  const r=az.run('az login');
  assert.match(r.out,/\[Tenant and subscription selection\]/);
  assert.equal(r.ask.text,'Select a subscription and tenant (Type a number or Enter for no changes): ');
  const r2=az.answer('9');
  assert.match(r2.ask.text,/^Invalid selection\./);
  const r3=az.answer('2');
  assert.match(r3.out,/Subscription: Cloud Lab Dev/);
  assert.equal(json('az account show').name,'Cloud Lab Dev');
  ok('az account set -s "Azure subscription 1"');
  assert.equal(ok('az account show --query name -o tsv').out,'Azure subscription 1');
  const bad=run('az account set -s nope');
  assert.equal(bad.out,"ERROR: The subscription of 'nope' doesn't exist in cloud 'AzureCloud'.");
  const t=ok('az account list -o table').out.split('\n');
  assert.match(t[0],/^Name\s+CloudName\s+SubscriptionId\s+TenantId\s+State\s+IsDefault$/);
  assert.match(t[1],/^-+\s+-+/);
});

console.log('Grupos de recursos y errores de argumentos');
test('argumentos obligatorios, región inválida y comandos mal escritos',()=>{
  const{run,login}=env();login();
  let r=run('az group create -n rg1');
  assert.equal(r.code,2);
  assert.match(r.out,/^ERROR: the following arguments are required: --location\/-l\n\nExamples from AI knowledge base:/);
  r=run('az group create -l eastus');
  assert.match(r.out,/required: --name\/--resource-group\/-n\/-g/);
  r=run('az group create -n rg1 -l mars');
  assert.match(r.out,/^ERROR: \(LocationNotAvailableForResourceGroup\) The provided location 'mars' is not available for resource group\./);
  assert.match(r.out,/\nCode: LocationNotAvailableForResourceGroup\nMessage: /);
  r=run('az grop list');
  assert.equal(r.code,2);
  assert.match(r.out,/^az: 'grop' is not in the 'az' command group\./);
  assert.match(r.out,/The most similar choice to 'grop' is:\n\tgroup$/);
  r=run('az group list --foo bar');
  assert.match(r.out,/^ERROR: unrecognized arguments: --foo bar/);
  r=run('az group show -n');
  assert.match(r.out,/^ERROR: argument --name\/--resource-group\/-n\/-g: expected one argument/);
  r=run('az group list -o xml');
  assert.match(r.out,/^ERROR: argument --output\/-o: invalid choice: 'xml' \(choose from 'json', 'jsonc', 'none', 'table', 'tsv', 'yaml', 'yamlc'\)/);
  r=run('az vm resize -g x -n y');
  assert.match(r.out,/existe en Azure CLI 2\.91\.0, pero todavía no se simula/);
});
test('crear, mostrar, repetir y conflicto de región en un grupo',()=>{
  const{run,ok,login,json}=env();login();
  const g=json('az group create -n rg1 -l "West Europe" --tags env=dev');
  assert.equal(g.location,'westeurope');
  assert.deepEqual(g.tags,{env:'dev'});
  assert.equal(g.properties.provisioningState,'Succeeded');
  assert.match(g.id,/^\/subscriptions\/[0-9a-f-]{36}\/resourceGroups\/rg1$/);
  ok('az group create -n RG1 -l westeurope');
  const r=run('az group create -n rg1 -l eastus');
  assert.match(r.out,/\(InvalidResourceGroupLocation\) Invalid resource group location 'eastus'\. The Resource group already exists in location 'westeurope'\./);
  assert.equal(ok('az group exists -n rg1').out,'true');
  assert.equal(run('az group show -n nope').code,3);
  assert.match(run('az group create -n "mi grupo" -l eastus').out,/\(InvalidResourceGroup\) The provided resource group name 'mi grupo' has these invalid characters: ' '/);
});
test('borrar un grupo pide confirmación; --no-wait lo deja en Deleting hasta que pasa el tiempo',()=>{
  const{az,run,ok,login,clock}=env();login();
  ok('az group create -n rg1 -l eastus -o none');
  let r=run('az group delete -n rg1','quizá','n');
  assert.equal(r.out,'Operation cancelled.');
  assert.equal(ok('az group exists -n rg1').out,'true');
  r=az.run('az group delete -n rg1 && az group list --query "[].name" -o tsv');
  assert.equal(r.ask.text,'Are you sure you want to perform this operation? (y/n): ');
  r=az.answer('y');
  assert.equal(r.code,0);
  assert.equal(ok('az group exists -n rg1').out,'false');
  ok('az group create -n rg2 -l eastus -o none');
  ok('az group delete -n rg2 --yes --no-wait');
  assert.equal(ok('az group show -n rg2 --query properties.provisioningState -o tsv').out,'Deleting');
  assert.match(run('az storage account create -n stdeleting123 -g rg2').out,/\(ResourceGroupBeingDeleted\)/);
  clock.t+=31000;
  assert.equal(run('az group show -n rg2').code,3);
});

console.log('Máquinas virtuales y cuotas');
test('errores reales al crear una VM y ciclo stop/deallocate',()=>{
  const{run,ok,login,json}=env();login();
  ok('az group create -n rg -l spaincentral -o none');
  let r=run('az vm create -g rg -n vm1');
  assert.equal(r.out,'ERROR: usage error: --image IMAGE | --attach-os-disk DISK');
  r=run('az vm create -g rg -n vm1 --image UbuntuLTS');
  assert.match(r.out,/^ERROR: Invalid image "UbuntuLTS"\. Use a valid image URN/);
  r=run('az vm create -g rg -n vm1 --image Ubuntu2204');
  assert.equal(r.out,'ERROR: An RSA key file or key value must be supplied to SSH Key Value. You can use --generate-ssh-keys to let CLI generate one for you');
  r=run('az vm create -g rg -n vm1 --image Ubuntu2204 --size Standard_Foo --generate-ssh-keys');
  assert.match(r.out,/\(InvalidParameter\) The value Standard_Foo provided for the VM size is not valid\./);
  r=run('az vm create -g rg -n vm1 --image Ubuntu2204 --admin-username admin --generate-ssh-keys');
  assert.match(r.out,/This user name 'admin' meets the general requirements, but is specifically disallowed/);
  r=ok('az vm create -g rg -n vm1 --image ubuntu2204 --size standard_b1s --generate-ssh-keys');
  assert.match(r.out,/^WARNING: SSH key files '\/home\/user\/\.ssh\/id_rsa'/);
  const vm=JSON.parse(r.out.slice(r.out.indexOf('{')));
  assert.equal(vm.powerState,'VM running');
  assert.equal(vm.privateIpAddress,'10.0.0.4');
  // Las claves ya existen: la segunda VM no necesita --generate-ssh-keys y reutiliza la VNet del grupo.
  const vm2=json('az vm create -g rg -n vm2 --image Debian12 --size Standard_B1s');
  assert.equal(vm2.privateIpAddress,'10.0.0.5');
  assert.equal(json('az network vnet list -g rg').length,1);
  r=ok('az vm stop -g rg -n vm1');
  assert.match(r.out,/sigue cobrando el cómputo/);
  ok('az vm deallocate -g rg -n vm1');
  const t=ok('az vm list -d -o table').out.split('\n');
  assert.match(t[0],/^Name\s+ResourceGroup\s+PowerState\s+PublicIps\s+Fqdns\s+Location\s+Zones$/);
  assert.match(t.find(l=>l.startsWith('vm1')),/VM deallocated/);
  assert.equal(ok('az vm show -g rg -n vm1 -d --query publicIps -o tsv').out,'');
  ok('az vm delete -g rg -n vm2 --yes');
  assert.deepEqual(json('az vm list --query "[].name"'),['vm1']);
});
test('contraseña de una VM Windows: confirmación, longitud y complejidad',()=>{
  const{az,run,ok,login}=env();login();
  ok('az group create -n rg -l eastus -o none');
  let r=az.run('az vm create -g rg -n win01 --image Win2022Datacenter --size Standard_B2s --query powerState -o tsv');
  assert.deepEqual(r.ask,{text:'Admin Password: ',secret:true});
  r=az.answer('Abcdefgh1234!');assert.equal(r.ask.text,'Confirm Admin Password: ');
  r=az.answer('otra');assert.equal(r.ask.text,'Passwords do not match.\nAdmin Password: ');
  r=az.answer('short');r=az.answer('short');
  assert.equal(r.out,'ERROR: The password length must be between 12 and 123');
  r=run('az vm create -g rg -n win01 --image Win2022Datacenter --size Standard_B2s --query powerState -o tsv','abcdefghijklm','abcdefghijklm');
  assert.match(r.out,/Password must have the 3 of the following/);
  r=run('az vm create -g rg -n win01 --image Win2022Datacenter --size Standard_B2s --query powerState -o tsv','Abcdefgh1234!','Abcdefgh1234!');
  assert.equal(r.out,'VM running');
  r=run('az vm create -g rg -n nombre-demasiado-largo --image Win2022Datacenter --admin-password Abcdefgh1234!');
  assert.match(r.out,/Windows computer name cannot be more than 15 characters long/);
});
test('la cuota regional de vCPU se libera al desasignar',()=>{
  const{run,ok,login,json}=env();login();
  ok('az group create -n rg -l eastus -o none');
  ok('az vm create -g rg -n big --image Ubuntu2204 --size Standard_D8s_v5 --generate-ssh-keys -o none');
  let r=run('az vm create -g rg -n other --image Ubuntu2204 --size Standard_D4s_v5');
  assert.match(r.out,/\(QuotaExceeded\) Operation could not be completed as it results in exceeding approved standardDSv5Family Cores quota\. Additional details - Deployment Model: Resource Manager, Location: eastus, Current Limit: 10, Current Usage: 8, Additional Required: 4/);
  const u=json('az vm list-usage -l eastus --query "[?name.value==\'cores\'].currentValue | [0]"');
  assert.equal(u,8);
  ok('az vm deallocate -g rg -n big');
  ok('az vm create -g rg -n other --image Ubuntu2204 --size Standard_D4s_v5 -o none');
  r=run('az vm start -g rg -n big');
  assert.match(r.out,/QuotaExceeded/);
  assert.match(run('az vm create -g rg -n gpu --image Ubuntu2204 --size Standard_NC4as_T4_v3').out,/standardNCASv3_T4Family Cores quota.*Current Limit: 0/);
});

console.log('Almacenamiento y redes');
test('nombres de cuentas de almacenamiento: formato, únicos en Azure y réplica en la región emparejada',()=>{
  const{run,ok,login,json}=env();login();
  ok('az group create -n rg -l westeurope -o none');
  let r=run('az storage account create -n My_Storage -g rg');
  assert.match(r.out,/^ERROR: \(AccountNameInvalid\) My_Storage is not a valid storage account name\. Storage account name must be between 3 and 24 characters in length and use numbers and lower-case letters only\.\nCode: AccountNameInvalid/);
  r=run('az storage account create -n mystorageaccount -g rg');
  assert.match(r.out,/\(StorageAccountAlreadyTaken\) The storage account named mystorageaccount is already taken\.\nCode:/);
  assert.deepEqual(json('az storage account check-name -n mystorageaccount'),{message:'The storage account named mystorageaccount is already taken.',nameAvailable:false,reason:'AlreadyExists'});
  assert.equal(json('az storage account check-name -n stcloudlab2026').nameAvailable,true);
  const s=json('az storage account create -n stcloudlab2026 -g rg');
  assert.equal(s.sku.name,'Standard_RAGRS');
  assert.equal(s.kind,'StorageV2');
  assert.equal(s.secondaryLocation,'northeurope');
  assert.equal(s.primaryEndpoints.blob,'https://stcloudlab2026.blob.core.windows.net/');
  assert.equal(json('az storage account create -n stlrs2026 -g rg --sku standard_lrs').secondaryLocation,null);
  ok('az group create -n rg2 -l westeurope -o none');
  assert.match(run('az storage account create -n stcloudlab2026 -g rg2').out,/\(StorageAccountAlreadyExists\)/);
  assert.match(run('az storage account create -n stzrs2026 -g rg -l westus --sku Standard_ZRS').out,/Region doesn't support zone-redundant storage/);
});
test('redes virtuales: CIDR, solapes y subredes fuera de rango',()=>{
  const{run,ok,login,json}=env();login();
  ok('az group create -n rg -l westeurope -o none');
  const v=json('az network vnet create -g rg -n vnet1 --address-prefixes 10.10.0.0/16 --subnet-name web --subnet-prefixes 10.10.1.0/24');
  assert.deepEqual(v.newVNet.addressSpace.addressPrefixes,['10.10.0.0/16']);
  assert.equal(v.newVNet.subnets[0].addressPrefix,'10.10.1.0/24');
  assert.match(run('az network vnet subnet create -g rg --vnet-name vnet1 -n db --address-prefixes 10.10.1.128/25').out,/\(NetcfgSubnetRangesOverlap\) Subnet 'db' is not valid because its IP address range overlaps with that of an existing subnet 'web'/);
  assert.match(run('az network vnet subnet create -g rg --vnet-name vnet1 -n db --address-prefixes 10.20.0.0/24').out,/\(NetcfgSubnetRangeOutsideVnet\)/);
  assert.match(run('az network vnet subnet create -g rg --vnet-name vnet1 -n db --address-prefixes 10.10.2.9/24').out,/\(InvalidCIDRNotation\).*the address prefix should be 10\.10\.2\.0\/24\./);
  assert.match(run('az network vnet subnet create -g rg --vnet-name nope -n db --address-prefixes 10.10.2.0/24').out,/\(ResourceNotFound\) The Resource 'Microsoft\.Network\/virtualNetworks\/nope' under resource group 'rg' was not found/);
  ok('az network vnet subnet create -g rg --vnet-name vnet1 -n db --address-prefixes 10.10.2.0/24 -o none');
  const t=ok('az network vnet list -o table').out.split('\n');
  assert.match(t[2],/^vnet1\s+rg\s+westeurope\s+2\s+10\.10\.0\.0\/16/);
  ok('az vm create -g rg -n vm1 --image Ubuntu2204 --vnet-name vnet1 --subnet db --generate-ssh-keys -o none');
  assert.equal(json('az vm list -d --query "[0].privateIps"'),'10.10.2.4');
  assert.match(run('az network vnet delete -g rg -n vnet1').out,/\(InUseSubnetCannotBeDeleted\) Subnet db is in use/);
});

console.log('App Service, RBAC y shell');
test('planes y web apps: F1 único, nombres globales y runtimes',()=>{
  const{run,ok,login,json}=env();login();
  ok('az group create -n rg -l northeurope -o none');
  const p=json('az appservice plan create -g rg -n plan1 --sku F1');
  assert.deepEqual([p.sku.name,p.sku.tier,p.kind,p.reserved,p.location],['F1','Free','linux',true,'North Europe']);
  assert.match(run('az appservice plan create -g rg -n plan2 --sku F1').out,/The maximum number of Free Linux ServerFarms allowed in a Subscription is 1\./);
  assert.match(run('az webapp create -g rg -p plan1 -n portal').out,/\(Conflict\) Website with given name portal already exists\./);
  assert.match(run('az webapp create -g rg -p plan1 -n miapp --runtime ruby:3').out,/^ERROR: Linux Runtime 'ruby:3' is not supported\. Run 'az webapp list-runtimes --os-type linux' to cross check/);
  assert.equal(ok('az webapp create -g rg -p plan1 -n miapp-2026 --runtime "NODE:22-lts" --query defaultHostName -o tsv').out,'miapp-2026.azurewebsites.net');
  assert.equal(json('az webapp show -g rg -n miapp-2026').siteConfig.linuxFxVersion,'NODE|22-lts');
  // Sin comillas, la | de "NODE|22-lts" es una tubería de bash, como en una terminal real.
  assert.match(run('az webapp create -g rg -p plan1 -n otra-2026 --runtime NODE|22-lts').out,/bash: 22-lts: command not found/);
  assert.match(run('az appservice plan delete -g rg -n plan1 --yes').out,/cannot be deleted because it has web app\(s\) miapp-2026/);
});
test('asignaciones de rol con --scope obligatorio, $(...) y variables',()=>{
  const{run,ok,login,json}=env();login();
  ok('az group create -n rg -l eastus -o none');
  let r=run('az role assignment create --assignee ana.garcia@cloudlabdemo.onmicrosoft.com --role Reader');
  assert.match(r.out,/^ERROR: the following arguments are required: --scope/);
  r=run('az role assignment create --assignee ana.garcia@cloudlabdemo.onmicrosoft.com --role Reader --scope rg');
  assert.match(r.out,/\(MissingSubscription\) The request did not have a subscription or a valid tenant level resource provider\./);
  r=run('az role assignment create --assignee pepe@contoso.com --role Reader --scope $(az group show -n rg --query id -o tsv)');
  assert.match(r.out,/Cannot find user or service principal in graph database for 'pepe@contoso.com'/);
  r=run('az role assignment create --assignee ana.garcia --role Readerr --scope $(az group show -n rg --query id -o tsv)');
  assert.equal(r.out,"ERROR: Role 'Readerr' doesn't exist.");
  r=ok('SCOPE=$(az group show -n rg --query id -o tsv) && az role assignment create --assignee ana.garcia@cloudlabdemo.onmicrosoft.com --role reader --scope $SCOPE --query "{role:roleDefinitionName, scope:scope}" -o json');
  assert.match(JSON.parse(r.out).scope,/\/resourceGroups\/rg$/);
  assert.match(run('az role assignment create --assignee ana.garcia --role Reader --scope $SCOPE').out,/\(RoleAssignmentExists\) The role assignment already exists\./);
  assert.equal(json('az role assignment list').length,1,'por defecto solo el ámbito de suscripción');
  const all=ok('az role assignment list --all -o table').out.split('\n');
  assert.match(all[0],/^Principal\s+Role\s+Scope$/);
  assert.equal(all.length,4);
  assert.equal(ok('echo $SCOPE | grep -c resourceGroups').out,'1');
});
test('JMESPath, tsv, yaml y --query inválido',()=>{
  const{run,ok,login,json}=env();login();
  for(const [n,l] of [['rg-b','westus'],['rg-a','eastus'],['rg-c','eastus']])ok(`az group create -n ${n} -l ${l} -o none --tags env=${n.slice(-1)}`);
  assert.deepEqual(json('az group list --query "[?location==\'eastus\'].name"'),['rg-a','rg-c']);
  assert.deepEqual(json('az group list --query "sort_by(@, &name)[].name"'),['rg-a','rg-b','rg-c']);
  assert.deepEqual(json('az group list --query "[?starts_with(name, \'rg-\') && location!=\'westus\'] | length(@)"'),2);
  assert.deepEqual(json('az group list --query "[0].{n:name, env:tags.env}"'),{n:'rg-b',env:'b'});
  assert.deepEqual(json('az group list --query "[].[name, location][0]"'),['rg-b','westus']);
  assert.deepEqual(json('az group list --query "max_by(@, &name).name"'),'rg-c');
  assert.deepEqual(json('az group list --query "[-1:].name"'),['rg-c']);
  assert.deepEqual(json('az group list --query "[*].tags.env | join(\',\', @)"'),'b,a,c');
  assert.equal(ok('az group list --query "[].[name,location]" -o tsv').out,'rg-b\twestus\nrg-a\teastus\nrg-c\teastus');
  assert.match(ok('az group show -n rg-a -o yaml').out,/^id: \/subscriptions\/.*\nlocation: eastus\nmanagedBy: null\nname: rg-a\n/);
  assert.equal(ok('az group show -n rg-a -o none').out,'');
  assert.equal(run('az group list --query "[?name=="').out,"ERROR: argument --query: invalid jmespath_type value: '[?name=='");
  assert.deepEqual(AzSim.jmespath.search({a:[{b:1},{b:2},{c:3}]},'a[].b'),[1,2]);
  assert.deepEqual(AzSim.jmespath.search({a:[[1,2],[3]]},'a[]'),[1,2,3]);
  assert.deepEqual(AzSim.jmespath.search({a:{x:{v:1},y:{v:2}}},'a.*.v'),[1,2]);
});

console.log('AKS y kubectl compartido');
test('aks create --no-wait pasa de Creating a Succeeded con el tiempo',()=>{
  const{run,ok,login,clock}=env();login();
  ok('az configure --defaults group=rg location=eastus');
  ok('az group create -n rg -o none');
  ok('az aks create -n aks1 --node-count 1 --generate-ssh-keys --no-wait');
  assert.equal(ok('az aks show -n aks1 --query provisioningState -o tsv').out,'Creating');
  assert.match(run('az aks scale -n aks1 -c 2').out,/\(OperationNotAllowed\) Operation is not allowed because there's an in progress create managed cluster operation/);
  assert.match(run('az aks get-credentials -n aks1').out,/still being created/);
  clock.t+=91000;
  assert.equal(ok('az aks show -n aks1 --query provisioningState -o tsv').out,'Succeeded');
  const groups=ok('az group list --query "[].name" -o tsv').out.split('\n');
  assert.deepEqual(groups,['rg','MC_rg_aks1_eastus']);
  assert.match(run('az group delete -n MC_rg_aks1_eastus --yes').out,/lo gestiona un clúster AKS/);
});
test('get-credentials crea el contexto; kubectl ve los nodos; scale/stop/delete se reflejan',()=>{
  const{run,ok,login,k8s}=env();login();
  ok('az group create -n rg -l eastus -o none');
  assert.match(run('az aks create -g rg -n aks1 -c 1').out,/An RSA key file or key value must be supplied/);
  const a=JSON.parse(ok('az aks create -g rg -n aks1 -c 1 --generate-ssh-keys').out.replace(/^WARNING:.*\n/,''));
  assert.equal(a.agentPoolProfiles[0].count,1);
  assert.equal(a.kubernetesVersion,'1.35.4');
  assert.match(a.fqdn,/^aks1-rg-[0-9a-f]{6}-[0-9a-f]{8}\.hcp\.eastus\.azmk8s\.io$/);
  // Antes de get-credentials, kubectl sigue en minikube.
  assert.match(ok('kubectl get nodes').out,/^NAME\s+STATUS[\s\S]*\nminikube\s+Ready\s+control-plane/);
  assert.equal(ok('az aks get-credentials -g rg -n aks1').out,'Merged "aks1" as current context in /home/user/.kube/config');
  let n=ok('kubectl get nodes').out.split('\n');
  assert.equal(n.length,2);
  assert.match(n[1],/^aks-nodepool1-\d{8}-vmss000000\s+Ready\s+<none>\s+\S+\s+v1\.35\.4$/);
  assert.match(ok('kubectl config current-context').out,/^aks1$/);
  ok('az aks scale -g rg -n aks1 -c 3 -o none');
  assert.equal(ok('kubectl get nodes --no-headers | wc -l').out,'3');
  ok('kubectl create deployment web --image=nginx --replicas=2');
  // La terminal de Kubernetes (otra instancia, mismo estado guardado) ve lo mismo.
  const k=k8s();
  assert.equal(k.state.ctx.current,'aks1');
  assert.match(k.run('kubectl get deploy web').out,/^NAME\s+READY[\s\S]*\nweb\s/);
  ok('az aks stop -g rg -n aks1');
  assert.match(run('kubectl get pods').out,/i\/o timeout\ncloudlab: el clúster AKS "aks1" está detenido/);
  ok('az aks start -g rg -n aks1');
  assert.match(ok('kubectl get deploy').out,/\nweb\s/);
  ok('az aks delete -g rg -n aks1 --yes');
  const r=run('kubectl get nodes');
  assert.equal(r.code,1);
  assert.match(r.out,/dial tcp: lookup aks1-rg-[^ ]+\.hcp\.eastus\.azmk8s\.io on 127\.0\.0\.53:53: no such host/);
  assert.match(ok('kubectl config use-context minikube && kubectl get nodes').out,/\nminikube\s+Ready/);
  assert.deepEqual(ok('az group list --query "[].name" -o tsv').out,'rg');
});

console.log('Persistencia, autocompletado y shell');
test('el estado se conserva 48 h y caduca después',()=>{
  const{az,ok,login,clock}=env();login();
  ok('az group create -n rg -l eastus -o none');
  const saved=az.serialize();
  const now=()=>clock.t;
  clock.t+=47*3600*1000;
  const again=AzSim.create({yaml,now,saved});
  assert.equal(again.restored,true);
  assert.equal(again.run('az group list --query "[].name" -o tsv').out,'rg');
  clock.t+=2*3600*1000;
  const expired=AzSim.create({yaml,now,saved});
  assert.equal(expired.restored,false);
  assert.equal(expired.run('az group list').out,"ERROR: Please run 'az login' to setup account.");
  const r=az.run('lab reset');
  assert.equal(r.reset,true);
  assert.equal(az.state.loggedIn,false);
});
test('autocompletado de grupos, comandos, argumentos y valores',()=>{
  const{az,ok,login}=env();login();
  ok('az group create -n rg-cloudlab -l spaincentral -o none');
  ok('az vm create -g rg-cloudlab -n vm-web --image Ubuntu2204 --size Standard_B1s --generate-ssh-keys -o none');
  const c=l=>az.complete(l).candidates;
  assert.deepEqual(c('az gr'),['group']);
  assert.deepEqual(c('az vm dea'),['deallocate']);
  assert.ok(c('az vm create --im').includes('--image'));
  assert.ok(c('az vm create --image ').includes('Ubuntu2204'));
  assert.deepEqual(c('az vm deallocate -g rg-'),['rg-cloudlab']);
  assert.deepEqual(c('az vm deallocate -g rg-cloudlab -n '),['vm-web']);
  assert.ok(c('az group create -l spa').includes('spaincentral'));
  assert.ok(c('az vm list -o t').includes('table')&&c('az vm list -o t').includes('tsv'));
  assert.ok(c('kubectl get ').includes('pods'));
  ok('RG=rg-cloudlab');
  assert.deepEqual(c('az group show -n $R'),['$RG']);
});
test('ayuda de comandos y grupos, az find y az --version',()=>{
  const{ok,run}=env();
  const h=ok('az vm create --help').out;
  assert.match(h,/^\nCommand\n    az vm create : Create an Azure Virtual Machine\.\n\nArguments\n/);
  assert.match(h,/--name -n\s+\[Required\] : Name of the virtual machine\./);
  assert.match(h,/\nGlobal Arguments\n/);
  assert.match(h,/\nExamples\n/);
  const g=ok('az storage --help').out;
  assert.match(g,/\nGroup\n    az storage : Manage Azure Cloud Storage resources\.\n\nSubgroups:\n    account/);
  assert.match(ok('az find "storage account"').out,/^Finding examples\.\.\.\n\nHere are the most common ways to use \[storage account\]:/);
  assert.match(ok('az --version').out,/^azure-cli\s+2\.91\.0\n/);
  assert.match(ok('az').out,/Welcome to the cool new Azure CLI!/);
  assert.match(run('minikube start').out,/^bash: minikube: command not found/);
  assert.match(run('group list').out,/¿quisiste decir "az group"\?/);
});

console.log(`\n${passed} pruebas correctas, ${failed} fallidas`);
process.exit(failed?1:0);
