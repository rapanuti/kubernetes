# Cloud Lab
Portal de estudio en español de Kubernetes y Azure. Sitio estático sin compilación ni dependencias: inicio, teoría, práctica con terminales simuladas de Kubernetes y Azure CLI, documentación de Kubernetes y simulador de examen AZ-900.

## Desarrollo local
Desde este directorio:

```sh
python3 -m http.server 4173 --directory dist
```

Abre http://localhost:4173. El contenido vive en `dist/app.js`, la documentación de Kubernetes en `dist/k8s-docs.js`, el simulador AZ-900 en `dist/exam.js` con su banco de 160 preguntas en `dist/az900-data.js`, el diseño en `dist/style.css` y la estructura en `dist/index.html`. Las rutas usan hashes. El progreso se guarda únicamente en localStorage del navegador. Los ejercicios y las terminales no ejecutan comandos reales ni crean recursos cloud. La animación respeta la preferencia de movimiento reducido.

## Terminal de Kubernetes simulada
En `#kubernetes/practica` hay una terminal (xterm.js) conectada a un clúster minikube simulado (Kubernetes v1.37.1). Nada se ejecuta de verdad: `dist/lab/k8s-engine.js` mantiene el estado (nodos, namespaces, Deployments, ReplicaSets, Pods, Services, ConfigMaps, Secrets y eventos), interpreta `kubectl`, `minikube` y una mini shell (tuberías, `&&`, redirecciones y heredocs) y devuelve salidas y errores con el formato de kubectl. `dist/lab/k8s-lab.js` dibuja el mapa del clúster y los retos guiados; la terminal (edición de línea, historial, Tab, heredocs y preguntas interactivas) está en `dist/lab/term.js`, compartida con Azure. El estado se guarda en localStorage y caduca tras 48 h sin uso (`lab reset` lo reinicia).

Dependencias incluidas en `dist/vendor/` (licencia MIT): @xterm/xterm 6.0.0, @xterm/addon-fit 0.11.0 y js-yaml 5.4.3. Se cargan solo al abrir una de las prácticas.

Pruebas rápidas del motor con Node:

```sh
node -e "const y=require('./dist/vendor/js-yaml.js');const s=require('./dist/lab/k8s-engine.js').create({yaml:y});console.log(s.run('kubectl create deploy web --image=nginx --replicas=3').out)"
```

## Terminal de Azure CLI simulada
En `#azure/practica` hay una terminal que imita Azure CLI 2.91.0 en Azure Cloud Shell. `dist/lab/az-engine.js` es el motor (sin DOM, se prueba con Node) y `dist/lab/az-lab.js` dibuja la terminal, el mapa de la suscripción y 13 retos guiados de AZ-900.

- Comandos: `az login` (con selección de suscripción), `az logout`, `az account show|list|set|list-locations`, `az configure --defaults`, `az group create|list|show|exists|delete`, `az vm create|list|show|start|stop|deallocate|restart|delete|list-sizes|list-usage`, `az vm image list`, `az storage account create|list|show|delete|check-name`, `az network vnet create|list|show|delete`, `az network vnet subnet create|list|delete`, `az appservice plan create|list|delete`, `az webapp create|list|show|browse|delete|list-runtimes`, `az aks create|list|show|get-credentials|scale|stop|start|delete|get-versions`, `az role assignment create|list|delete`, `az role definition list`, `az ad user list|show`, `az resource list`, `az find`, `az version`, `az --version` y `--help` en cada grupo y comando.
- Opciones globales `-o json|jsonc|table|tsv|yaml|yamlc|none`, `--query` (JMESPath: filtros, proyecciones, multiselección, `length`, `sort_by`, `join`…), `--subscription`, `--only-show-errors`.
- Errores con el formato real: argumentos obligatorios (`the following arguments are required`), argumentos desconocidos, comandos mal escritos con sugerencias, errores de Azure Resource Manager (`(Código) mensaje / Code / Message`), regiones inexistentes, nombres de storage inválidos o ya usados, SKUs de VM inválidas, cuota regional de vCPU, CIDR mal formados o solapados, y preguntas `(y/n)` y de contraseña.
- Mini shell tipo bash: variables (`RG=rg-lab`, `$RG`), sustitución `$(az ... -o tsv)`, tuberías, `&&`, `;` y redirecciones.
- Estado compartido con Kubernetes: `az aks get-credentials` añade el contexto al kubeconfig de la terminal de Kubernetes (`cloudlab-aks-bridge` en localStorage). Desde ambas terminales, `kubectl` maneja el mismo clúster AKS (nodos según `az aks scale`, inaccesible si se para o se borra).
- Memoria de 48 h en localStorage (`cloudlab-az-lab`), `lab reset` para empezar de cero y autocompletado con Tab de comandos, argumentos, grupos, recursos, regiones, imágenes y tamaños.

## Pruebas
Escenarios del motor de Azure (y del puente con Kubernetes) con un reloj simulado:

```sh
node tests/az-engine.test.js
```
