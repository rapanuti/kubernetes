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
  r=run('az vm redeploy -g x -n y');
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

console.log('Gobierno: etiquetas, bloqueos y Azure Policy');
test('etiquetas de grupo con --tags, --set y --remove',()=>{
  const{ok,login,json}=env();login();
  ok('az group create -n rg -l eastus -o none');
  assert.deepEqual(json('az group update -n rg --tags env=dev team=web').tags,{env:'dev',team:'web'});
  assert.deepEqual(json('az group update -n rg --set tags.costCenter=1234').tags,{env:'dev',team:'web',costCenter:'1234'});
  assert.deepEqual(json('az group update -n rg --remove tags.team').tags,{env:'dev',costCenter:'1234'});
  assert.deepEqual(json('az group list --tag env=dev --query "[].name"'),['rg']);
});
test('CanNotDelete impide borrar; ReadOnly impide además escribir; al quitarlos se puede',()=>{
  const{run,ok,login,json,clock}=env();login();
  ok('az group create -n rg -l eastus -o none');
  ok('az vm create -g rg -n vm1 --image Ubuntu2204 --size Standard_B1s --generate-ssh-keys -o none');
  const l=json('az lock create -n no-borrar -g rg --lock-type CanNotDelete --notes "Producción"');
  assert.equal(l.level,'CanNotDelete');
  assert.match(l.id,/\/resourceGroups\/rg\/providers\/Microsoft\.Authorization\/locks\/no-borrar$/);
  let r=run('az group delete -n rg --yes');
  assert.match(r.out,/^ERROR: \(ScopeLocked\) The scope '\/subscriptions\/[^']+\/resourceGroups\/rg' cannot perform delete operation because following scope\(s\) are locked: '\/subscriptions\/[^']+\/resourceGroups\/rg'\. Please remove the lock and try again\./);
  assert.match(run('az vm delete -g rg -n vm1 --yes').out,/ScopeLocked/);
  ok('az vm deallocate -g rg -n vm1');
  ok('az lock create -n solo-lectura -g rg -t ReadOnly --resource vm1 --resource-type Microsoft.Compute/virtualMachines -o none');
  assert.match(run('az vm start -g rg -n vm1').out,/cannot perform write operation because following scope\(s\) are locked: '\/subscriptions\/[^']+\/resourceGroups\/rg\/providers\/Microsoft\.Compute\/virtualMachines\/vm1'/);
  const t=ok('az lock list -g rg -o table').out.split('\n');
  assert.match(t[0],/^Name\s+ResourceGroup\s+Level\s+Notes$/);
  assert.equal(t.length,4);
  ok('az lock delete -n solo-lectura -g rg --resource vm1 --resource-type Microsoft.Compute/virtualMachines');
  ok('az vm start -g rg -n vm1');
  // Un bloqueo en un recurso hijo también impide borrar el grupo.
  ok('az lock delete -n no-borrar -g rg');
  ok('az lock create -n vnet-lock -g rg -t CanNotDelete --resource vm1VNET --resource-type virtualNetworks -o none');
  assert.match(run('az group delete -n rg --yes').out,/following scope\(s\) are locked: '[^']+virtualNetworks\/vm1VNET'/);
  ok('az lock delete -n vnet-lock -g rg --resource vm1VNET --resource-type virtualNetworks');
  ok('az group delete -n rg --yes');
  assert.equal(json('az lock list').length,0);
  // ReadOnly en la cuenta de almacenamiento bloquea listKeys, así que falla el acceso por clave.
  ok('az group create -n rg2 -l eastus -o none');
  ok('az storage account create -n stlocked2026 -g rg2 -o none');
  ok('az lock create -n ro -g rg2 -t ReadOnly -o none');
  assert.match(run('az storage container create -n datos --account-name stlocked2026').out,/ScopeLocked/);
  assert.match(run('az group create -n rg2 -l eastus').out,/cannot perform write operation/);
  void clock;
});
test('Azure Policy: Allowed locations deniega, no afecta a los grupos y marca lo existente como no conforme',()=>{
  const{run,ok,login,json}=env();login();
  ok('az group create -n rg -l eastus -o none');
  ok('az storage account create -n steast2026 -g rg -o none');
  let r=run('az policy assignment create -n solo-europa --policy e56962a6-4747-49cd-b67b-bf8b01975c4c');
  assert.match(r.out,/\(MissingPolicyParameter\) The policy assignment 'solo-europa' is missing the parameter\(s\) 'listOfAllowedLocations'/);
  r=run("az policy assignment create -n solo-europa --policy e56962a6-4747-49cd-b67b-bf8b01975c4c --params '{\"listOfAllowedLocations\":{\"value\":[\"westeurope\",\"spaincentral\"]}'");
  assert.match(r.out,/^ERROR: Failed to parse string as JSON:/);
  const a=json("az policy assignment create -n solo-europa --display-name \"Solo Europa\" --policy e56962a6-4747-49cd-b67b-bf8b01975c4c --params '{\"listOfAllowedLocations\":{\"value\":[\"westeurope\",\"spaincentral\"]}}'");
  assert.equal(a.policyDefinitionId,'/providers/Microsoft.Authorization/policyDefinitions/e56962a6-4747-49cd-b67b-bf8b01975c4c');
  assert.deepEqual(a.parameters,{listOfAllowedLocations:{value:['westeurope','spaincentral']}});
  // El grupo en eastus ya existe: se puede usar, pero un recurso nuevo allí queda denegado.
  r=run('az vm create -g rg -n vm1 --image Ubuntu2204 --size Standard_B1s --generate-ssh-keys');
  assert.match(r.out,/^ERROR: \(RequestDisallowedByPolicy\) Resource 'vm1' was disallowed by policy\. Policy identifiers: '\[\{"policyAssignment":\{"name":"Solo Europa","id":"\/subscriptions\/[^"]+\/providers\/Microsoft\.Authorization\/policyAssignments\/solo-europa"\},"policyDefinition":\{"name":"Allowed locations"/);
  assert.match(r.out,/\nTarget: vm1\n/);
  ok('az vm create -g rg -n vm1 -l westeurope --image Ubuntu2204 --size Standard_B1s --generate-ssh-keys -o none');
  ok('az group create -n rg-us -l westus -o none');
  // No conformes: la cuenta de eastus (creada antes de la política). La VM y su VNet están en westeurope y los grupos no cuentan.
  const st=json('az policy state list --only-show-errors --query "[].resourceId"');
  assert.equal(st.length,1);
  assert.match(st[0],/storageAccounts\/steast2026$/);
  assert.equal(json('az policy state summarize --query results.nonCompliantResources'),1);
  ok('az policy assignment delete -n solo-europa');
  ok('az storage account create -n steast2027 -g rg -o none');
  // Requerir etiqueta en recursos y tamaños de VM permitidos, en el ámbito de un grupo.
  ok("az policy assignment create -n tag-env -g rg --policy 871b6d14-10aa-478d-b590-94f262ecfa99 --params '{\"tagName\":{\"value\":\"env\"}}' -o none");
  assert.match(run('az storage account create -n sttag2026 -g rg').out,/RequestDisallowedByPolicy/);
  ok('az storage account create -n sttag2026 -g rg --tags env=dev -o none');
  ok("az policy assignment create -n vm-pequenas -g rg --policy 'Allowed virtual machine size SKUs' --params '{\"listOfAllowedSKUs\":[\"Standard_B1s\",\"Standard_B2s\"]}' -o none");
  assert.match(run('az vm create -g rg -n vm2 -l westeurope --image Ubuntu2204 --size Standard_D2s_v5 --tags env=dev').out,/Allowed virtual machine size SKUs/);
  assert.match(run('az vm resize -g rg -n vm1 --size Standard_D2s_v5').out,/RequestDisallowedByPolicy/);
  assert.equal(json('az policy assignment list -g rg --query "length(@)"'),2);
  assert.equal(json('az policy definition list --only-show-errors --query "length(@)"'),6);
});

console.log('Datos: blobs y Key Vault');
test('blobs: aviso sin credenciales, rol de datos con --auth-mode login y errores del servicio',()=>{
  const{run,ok,login,json}=env();login();
  ok('az group create -n rg -l westeurope -o none');
  ok('az storage account create -n stdatos2026 -g rg --sku Standard_LRS -o none');
  let r=ok('az storage container create -n imagenes --account-name stdatos2026');
  assert.match(r.out,/There are no credentials provided in your command and environment, we will query for account key for your storage account\./);
  assert.match(r.out,/\{\n  "created": true\n\}$/);
  assert.match(run('az storage container create -n Imagenes_1 --account-name stdatos2026 --auth-mode key --account-key x').out,/AuthenticationFailed/);
  const key=ok('az storage account keys list -n stdatos2026 -g rg --query [0].value -o tsv').out;
  assert.match(run(`az storage container create -n Imagenes_1 --account-name stdatos2026 --account-key ${key}`).out,/^ERROR: The specifed resource name contains invalid characters\.\nRequestId:[0-9a-f-]+\nTime:[^\n]+\nErrorCode:InvalidResourceName$/);
  assert.match(run('az storage container create -n web --public-access blob --account-name stdatos2026 --account-key '+key).out,/ErrorCode:PublicAccessNotPermitted/);
  r=run('az storage blob upload -c imagenes -n hola.txt --data "Hola Azure" --account-name stdatos2026 --auth-mode login');
  assert.match(r.out,/You do not have the required permissions needed to perform this operation\./);
  assert.match(r.out,/"Storage Blob Data Contributor"/);
  ok('SCOPE=$(az storage account show -n stdatos2026 -g rg --query id -o tsv) && az role assignment create --assignee user@cloudlabdemo.onmicrosoft.com --role "Storage Blob Data Contributor" --scope $SCOPE -o none');
  assert.match(run('az storage blob upload -c imagenes -f nota.txt --account-name stdatos2026 --auth-mode login').out,/No such file or directory: 'nota.txt'/);
  ok('echo "Hola Azure" > nota.txt');
  r=ok('az storage blob upload -c imagenes -f nota.txt --account-name stdatos2026 --auth-mode login');
  assert.match(r.out,/(^|\n)Finished\[#+\]  100\.0000%/);
  assert.match(run('az storage blob upload -c imagenes -f nota.txt --account-name stdatos2026 --auth-mode login').out,/ERROR: The specified blob already exists\.[\s\S]*ErrorCode:BlobAlreadyExists/);
  ok('az storage blob upload -c imagenes -f nota.txt --overwrite --account-name stdatos2026 --auth-mode login -o none');
  const t=ok('az storage blob list -c imagenes --account-name stdatos2026 --auth-mode login -o table').out.split('\n');
  assert.match(t[0],/^Name\s+Blob Type\s+Blob Tier\s+Length\s+Content Type\s+Last Modified\s+Snapshot$/);
  assert.match(t[2],/^nota\.txt\s+BlockBlob\s+Hot\s+11\s+text\/plain\s/);
  assert.equal(ok('az storage blob download -c imagenes -n nota.txt --account-name stdatos2026 --auth-mode login').out,'Hola Azure');
  ok('az storage blob download -c imagenes -n nota.txt -f copia.txt --account-name stdatos2026 --auth-mode login -o none');
  assert.equal(ok('cat copia.txt').out,'Hola Azure');
  assert.match(run('az storage blob show -c imagenes -n nada.txt --account-name stdatos2026 --auth-mode login').out,/ErrorCode:BlobNotFound/);
  assert.match(run('az storage blob list -c nada --account-name stdatos2026 --auth-mode login').out,/ErrorCode:ContainerNotFound/);
  ok('az storage blob delete -c imagenes -n nota.txt --account-name stdatos2026 --auth-mode login');
  assert.deepEqual(json('az storage blob list -c imagenes --account-name stdatos2026 --auth-mode login'),[]);
  assert.match(json('az storage account show-connection-string -n stdatos2026 -g rg').connectionString,/^DefaultEndpointsProtocol=https;EndpointSuffix=core\.windows\.net;AccountName=stdatos2026;AccountKey=/);
});
test('Key Vault: RBAC en el plano de datos, soft-delete, recover y purga',()=>{
  const{run,ok,login,json}=env();login();
  ok('az group create -n rg -l westeurope -o none');
  assert.match(run('az keyvault create -n 1kv -g rg').out,/\(VaultNameNotValid\) The vault name '1kv' is invalid\./);
  assert.match(run('az keyvault create -n mykeyvault -g rg').out,/\(VaultAlreadyExists\) The vault name 'mykeyvault' is already in use\./);
  const k=json('az keyvault create -n kv-cloudlab-2026 -g rg');
  assert.deepEqual([k.properties.enableRbacAuthorization,k.properties.softDeleteRetentionInDays,k.properties.sku.name,k.properties.vaultUri],[true,90,'standard','https://kv-cloudlab-2026.vault.azure.net/']);
  let r=run('az keyvault secret set --vault-name kv-cloudlab-2026 -n db-password --value "S3cr3t!"');
  assert.match(r.out,/^ERROR: \(Forbidden\) Caller is not authorized to perform action on resource\./);
  assert.match(r.out,/Action: 'Microsoft\.KeyVault\/vaults\/secrets\/setSecret\/action'/);
  assert.match(r.out,/"code": "ForbiddenByRbac"/);
  ok('az role assignment create --assignee user@cloudlabdemo.onmicrosoft.com --role "Key Vault Secrets Officer" --scope $(az keyvault show -n kv-cloudlab-2026 --query id -o tsv) -o none');
  const sec=json('az keyvault secret set --vault-name kv-cloudlab-2026 -n db-password --value "S3cr3t!"');
  assert.match(sec.id,/^https:\/\/kv-cloudlab-2026\.vault\.azure\.net\/secrets\/db-password\/[0-9a-f]{32}$/);
  assert.equal(ok('az keyvault secret show --vault-name kv-cloudlab-2026 -n db-password --query value -o tsv').out,'S3cr3t!');
  assert.equal(json('az keyvault secret list --vault-name kv-cloudlab-2026')[0].value,undefined);
  assert.match(run('az keyvault secret show --vault-name kv-cloudlab-2026 -n nada').out,/\(SecretNotFound\)/);
  r=ok('az keyvault delete -n kv-cloudlab-2026');
  assert.match(r.out,/soft-delete/);
  assert.equal(json('az keyvault list-deleted --query "[].name"')[0],'kv-cloudlab-2026');
  assert.match(run('az keyvault create -n kv-cloudlab-2026 -g rg').out,/VaultAlreadyExists[\s\S]*az keyvault recover -n kv-cloudlab-2026/);
  ok('az keyvault recover -n kv-cloudlab-2026 -o none');
  assert.equal(ok('az keyvault secret show --vault-name kv-cloudlab-2026 -n db-password --query value -o tsv').out,'S3cr3t!');
  ok('az keyvault delete -n kv-cloudlab-2026 && az keyvault purge -n kv-cloudlab-2026');
  ok('az keyvault create -n kv-cloudlab-2026 -g rg --enable-purge-protection true -o none');
  ok('az keyvault delete -n kv-cloudlab-2026');
  assert.match(run('az keyvault purge -n kv-cloudlab-2026').out,/purge protection is enabled/);
});

console.log('Red: NSG, IP pública y más comandos de VM');
test('reglas de NSG, vm open-port, IP pública Standard y resize',()=>{
  const{run,ok,login,json}=env();login();
  ok('az group create -n rg -l eastus -o none');
  ok('az vm create -g rg -n vm1 --image Ubuntu2204 --size Standard_B1s --generate-ssh-keys -o none');
  let rules=ok('az network nsg rule list -g rg --nsg-name vm1NSG -o table').out.split('\n');
  assert.match(rules[0],/^Name\s+ResourceGroup\s+Priority\s+SourcePortRanges\s+SourceAddressPrefixes\s+SourceASG\s+Access\s+Protocol\s+Direction\s+DestinationPortRanges\s+DestinationAddressPrefixes\s+DestinationASG$/);
  assert.match(rules[2],/^default-allow-ssh\s+rg\s+1000\s+\*\s+\*\s+None\s+Allow\s+Tcp\s+Inbound\s+22\s+\*\s+None$/);
  const nsg=json('az vm open-port -g rg -n vm1 --port 80');
  assert.deepEqual(nsg.securityRules.map(r=>[r.name,r.priority,r.destinationPortRange]),[['open-port-80',900,'80'],['default-allow-ssh',1000,'22']]);
  assert.match(run('az vm open-port -g rg -n vm1 --port 443').out,/\(SecurityRuleConflict\) Security rule open-port-443 conflicts with rule open-port-80\. Rules cannot have the same Priority and Direction\./);
  assert.match(run('az network nsg rule create -g rg --nsg-name vm1NSG -n mala --priority 50').out,/\(SecurityRuleInvalidPriority\) Security rule has invalid Priority\. Value provided: 50 Allowed range 100-4096\./);
  assert.match(run('az network nsg rule create -g rg --nsg-name vm1NSG -n mala').out,/the following arguments are required: --priority/);
  ok('az network nsg rule create -g rg --nsg-name vm1NSG -n deny-rdp --priority 200 --access Deny --protocol Tcp --destination-port-ranges 3389 -o none');
  assert.equal(json('az network nsg rule list -g rg --nsg-name vm1NSG --include-default --query "length(@)"'),9);
  assert.match(run('az network nsg delete -g rg -n vm1NSG').out,/\(InUseNetworkSecurityGroupCannotBeDeleted\)/);
  ok('az network nsg create -g rg -n nsg-web -o none');
  assert.deepEqual(json('az network nsg list -g rg --query "[].name"'),['vm1NSG','nsg-web']);
  assert.match(run('az network public-ip create -g rg -n ip1 --allocation-method Dynamic').out,/StandardSkuPublicIPAddressesCannotHaveDynamicAllocation/);
  assert.match(run('az network public-ip create -g rg -n ip1 --sku Basic').out,/se retiraron|retiró/);
  const ip=json('az network public-ip create -g rg -n ip1').publicIp;
  assert.deepEqual([ip.sku.name,ip.publicIPAllocationMethod],['Standard','Static']);
  assert.equal(json('az network public-ip list -g rg --query "length(@)"'),2);
  const ips=ok('az vm list-ip-addresses -g rg -o table').out.split('\n');
  assert.match(ips[0],/^VirtualMachine\s+PublicIPAddresses\s+PrivateIPAddresses$/);
  assert.match(ips[2],/^vm1\s+[\d.]+\s+10\.0\.0\.4$/);
  assert.equal(json('az vm resize -g rg -n vm1 --size Standard_B2s --query hardwareProfile.vmSize'),'Standard_B2s');
  assert.match(run('az vm resize -g rg -n vm1 --size Standard_NC4as_T4_v3').out,/QuotaExceeded/);
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
test('dos instancias del simulador no comparten estado',()=>{
  const a=env(),b=env();a.login();
  a.ok('az group create -n solo-a -l eastus -o none');
  assert.equal(b.run('az group list').out,"ERROR: Please run 'az login' to setup account.");
  assert.equal(a.ok('az group list --query "[].name" -o tsv').out,'solo-a');
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
