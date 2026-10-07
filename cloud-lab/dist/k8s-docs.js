// Documentación de Kubernetes en español (ruta #kubernetes/docs). Diagramas en HTML/CSS.
(()=>{
const box=(t,s,c='')=>`<div class="node ${c}"><b>${t}</b>${s?`<small>${s}</small>`:''}</div>`;
const flow=(items,c='')=>`<div class="flow ${c}">${items.map(i=>box(...i)).join('<span class="arr" aria-hidden="true"></span>')}</div>`;
const down='<span class="arr down" aria-hidden="true"></span>';
const fan=(chain,kids)=>`<div class="fan">${chain.map(c=>box(...c)).join(down)}${kids?`${down}<div class="fan-kids">${kids.map(k=>box(...k)).join('')}</div>`:''}</div>`;
const table=(head,rows)=>`<div class="table-wrap"><table class="doc-table"><thead><tr>${head.map(x=>`<th>${x}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(x=>`<td>${x}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
const cmds=rows=>table(['Comando','Para qué sirve','Ejemplo'],rows.map(([c,d,e])=>[`<code>${c}</code>`,d,e?`<code>${e}</code>`:'—']));
const list=items=>`<ul class="doc-list">${items.map(i=>`<li>${i}</li>`).join('')}</ul>`;
const note=(title,body,c='')=>`<div class="note ${c}"><strong>${title}</strong>${body}</div>`;
const short=t=>`<p class="short"><b>En resumen:</b> ${t}</p>`;
const fix=t=>note('✎ Precisión',`<p>${t}</p>`,'fix');
const pod=(n,label='Pod')=>`<div class="pod-box"><b>${label}</b><div class="pod-cts">${Array.from({length:n},(_,i)=>`<span>Contenedor ${i+1}</span>`).join('')}</div></div>`;
const yaml=t=>`<pre><code>${t}</code></pre>`;
const two=(a,b)=>`<div class="two"><div>${a}</div><div>${b}</div></div>`;

const sections=[
['que-es','¿Qué es Kubernetes?',`
<h3>1. Definición</h3>
${two(`<div><p>Kubernetes (K8s) es una plataforma de código abierto para <b>orquestar contenedores</b>. Automatiza el despliegue, el escalado, la gestión y la red de aplicaciones en contenedores.</p><p>Lo creó Google a partir de su experiencia con sistemas internos como Borg, y hoy lo mantiene la <b>CNCF</b> (Cloud Native Computing Foundation).</p></div>`,note('En pocas palabras','<p>Kubernetes te ayuda a ejecutar aplicaciones en contenedores de forma fiable y a escala.</p>'))}
<h3>2. ¿Por qué nació Kubernetes?</h3>
${two(`<p>Con Docker se pueden ejecutar contenedores, pero gestionar <b>muchos contenedores a mano</b>, en varios servidores, es muy difícil. Kubernetes resuelve esos problemas de forma declarativa: le dices qué estado quieres y él trabaja para mantenerlo.</p>`,note('Problemas de usar solo Docker',list(['Difícil gestionar muchos contenedores','Sin escalado automático','Sin autorreparación si un contenedor falla','Sin balanceo de carga integrado','Sin actualizaciones progresivas (rolling updates)','Red y almacenamiento complicados entre servidores']),'dashed'))}
<h3>3. Características principales</h3>
${list(['Despliegue y escalado automáticos','Autorreparación: reinicia contenedores fallidos y reemplaza Pods','Balanceo de carga y descubrimiento de servicios','Actualizaciones progresivas y rollback','Orquestación del almacenamiento','Gestión de configuración y Secrets','Funciona en cualquier entorno: on-premises, nube o híbrido'])}
<h3>4. Orquestación de contenedores</h3>
<p>Orquestar contenedores significa gestionar <b>todo su ciclo de vida</b> de forma automática: desplegarlos, escalarlos, conectarlos en red y supervisarlos.</p>
${flow([['Aplicación'],['Pods','unidad desplegable más pequeña'],['Kubernetes','capa de orquestación'],['Clúster','conjunto de nodos']],'vertical-sm')}
${table(['','Docker (solo)','Kubernetes'],[['Alcance','Gestiona contenedores en un host','Gestiona muchos contenedores en muchos nodos'],['Operación','Manual','Automática y declarativa'],['Escalado y autorreparación','No incluidos','Escalado automático y autorreparación']])}
${fix('Kubernetes no sustituye a Docker como herramienta para construir imágenes: las imágenes creadas con Docker funcionan en Kubernetes. Lo que Kubernetes aporta es la orquestación.')}`],

['arquitectura','Arquitectura',`
<h3>1. Arquitectura de Kubernetes</h3>
${two(`<p>Kubernetes sigue una arquitectura de <b>plano de control y nodos de trabajo</b>. El clúster se divide en dos partes:</p>${list(['<b>Plano de control</b> (control plane, antes llamado <i>master</i>)','<b>Nodos de trabajo</b> (worker nodes)'])}`,`<div class="fan">${box('Usuario / Cliente')}${down}${box('kubectl')}${down}${box('Clúster de Kubernetes')}${down}<div class="fan-kids">${box('Plano de control','decide')}${box('Nodos de trabajo','ejecutan')}</div></div>`)}
<h3>2. Componentes del plano de control</h3>
<p>El plano de control toma decisiones globales sobre el clúster (por ejemplo, dónde programar Pods), detecta eventos y responde a ellos, y mantiene el <b>estado deseado</b>.</p>
<div class="comp-grid">${[['API Server','La puerta de entrada de Kubernetes. Expone la API REST que usan kubectl y el resto de componentes. Todas las peticiones pasan por él.'],['etcd','Almacén clave-valor consistente y de alta disponibilidad con todos los datos del clúster.'],['Scheduler','Vigila los Pods nuevos sin nodo asignado y elige el nodo más adecuado para cada uno.'],['Controller Manager','Ejecuta los controladores (de nodos, de ReplicaSets, etc.) que reconcilian el estado actual con el deseado.']].map(([t,d])=>`<div class="comp"><b>${t}</b><p>${d}</p></div>`).join('')}</div>
<h3>3. Componentes de los nodos de trabajo</h3>
<p>Los nodos de trabajo ejecutan las aplicaciones en contenedores y mantienen su entorno de ejecución.</p>
${table(['Componente','Función'],[['<b>kubelet</b>','Agente de cada nodo. Se comunica con el plano de control y se asegura de que los contenedores de cada Pod estén en marcha.'],['<b>kube-proxy</b>','Mantiene las reglas de red del nodo para que funcionen los Services.'],['<b>Container runtime</b>','Descarga imágenes y ejecuta los contenedores (por ejemplo, containerd o CRI-O).']])}
${fix('Desde Kubernetes 1.24 el runtime ya no es Docker Engine directamente (se retiró dockershim); se usan runtimes compatibles con CRI como containerd o CRI-O. El término <i>minions</i> para los nodos de trabajo está obsoleto.')}
${short('el plano de control gestiona el clúster y los nodos de trabajo ejecutan las aplicaciones.')}`],

['pods','Pods',`
<h3>1. ¿Qué es un Pod?</h3>
${two(`<div><p>Un Pod es la <b>unidad desplegable más pequeña</b> de Kubernetes. Representa uno o varios contenedores que comparten red, almacenamiento y configuración.</p><p>Los contenedores de un mismo Pod se programan siempre juntos en el mismo nodo.</p></div>`,`<div class="pod-box big"><b>Pod</b><div class="pod-cts"><span>Contenedor 1</span><span>Contenedor 2</span></div><div class="pod-shared">Red compartida (una IP)</div><div class="pod-shared">Almacenamiento compartido (volúmenes)</div></div>`)}
<h3>2. Tipos de Pod</h3>
${two(`${list(['<b>Pod de un solo contenedor:</b> el caso más habitual.','<b>Pod multicontenedor:</b> varios contenedores muy acoplados que trabajan juntos (por ejemplo, la aplicación y un <i>sidecar</i> que recoge logs).'])}`,`<div class="row-boxes">${pod(1)}${pod(2)}</div>`)}
<h3>3. Ciclo de vida de un Pod</h3>
<p>Un Pod pasa por distintas <b>fases</b> durante su vida:</p>
${flow([['Pending','aceptado por el clúster; aún no está listo para ejecutarse'],['Running','asignado a un nodo y con al menos un contenedor en marcha'],['Succeeded','todos los contenedores terminaron con éxito'],['Failed','algún contenedor terminó con error'],['Unknown','no se puede saber su estado (p. ej., nodo sin conexión)']])}
${fix('Un Pod no "vuelve" a Pending. Lo que se reinicia son sus contenedores dentro del mismo Pod, según su <code>restartPolicy</code>. Estados como <i>ContainerCreating</i>, <i>CrashLoopBackOff</i> o <i>Terminating</i>, que muestra <code>kubectl get pods</code>, describen contenedores o eventos, no fases del Pod.')}
<h3>4. ¿Por qué Pods y no contenedores sueltos?</h3>
${table(['Contenedor (Docker)','Pod (Kubernetes)'],[['Un solo contenedor','Uno o más contenedores'],['Gestión manual','Gestionado por Kubernetes'],['Sin autorreparación','Se reinicia o reemplaza si falla'],['Escalado manual','Escalado automático (con controladores)'],['Sin recursos compartidos','Comparte red y almacenamiento']])}
${yaml(`apiVersion: v1
kind: Pod
metadata:
  name: web
  labels:
    app: web
spec:
  containers:
    - name: nginx
      image: nginx:1.27
      ports:
        - containerPort: 80`)}
${short('el Pod es la unidad más pequeña y simple que Kubernetes crea o despliega. Envuelve uno o más contenedores muy acoplados.')}`],

['deployments','Deployments y ReplicaSets',`
<h3>1. Deployments</h3>
${two(`<div><p>Un Deployment gestiona ReplicaSets y ofrece <b>actualizaciones declarativas</b> de Pods. Es una abstracción de más alto nivel que el ReplicaSet y es la forma recomendada de ejecutar aplicaciones sin estado.</p><p>Te ayuda con:</p>${list(['Escalado','Actualizaciones progresivas (rolling updates)','Rollback','Autorreparación: mantiene el número deseado de Pods'])}</div>`,`<div class="fan">${box('Deployment','gestiona ReplicaSets (estado deseado)')}${down}${box('ReplicaSet','mantiene N réplicas')}${down}<div class="fan-kids">${box('Pod')}${box('Pod')}${box('Pod')}</div></div>`)}
<h3>2. ReplicaSet</h3>
${two(`<p>Un ReplicaSet garantiza que haya un número concreto de réplicas de un Pod en ejecución. Si un Pod falla, crea otro para mantener el estado deseado.</p>`,note('Puntos clave',list(['Ayuda a la alta disponibilidad','Mantiene el número deseado de Pods','Vigila los Pods continuamente','Normalmente lo gestiona un Deployment']),'dashed'))}
${table(['Característica','ReplicaSet','Deployment'],[['Propósito','Mantener N réplicas de un Pod','Gestionar ReplicaSets con actualizaciones declarativas'],['Rolling updates','No','Sí'],['Rollback','No','Sí, a revisiones anteriores'],['Escalado','Sí (réplicas)','Sí (réplicas)'],['Autorreparación','Sí','Sí'],['Uso','Rara vez directamente','Lo habitual en producción']])}
<h3>3. Escalado</h3>
${two(list(['<b>Manual:</b> con <code>kubectl scale</code>.','<b>Automático:</b> con el HPA (Horizontal Pod Autoscaler), que ajusta las réplicas según métricas como la CPU.']),flow([['Escalar hacia arriba','más Pods para atender la carga'],['Escalar hacia abajo','menos Pods para ahorrar recursos']]))}
<h3>4. Rolling update: cómo funciona</h3>
<p>Actualiza la aplicación <b>sin tiempo de inactividad</b>: se crean Pods nuevos poco a poco y se eliminan los antiguos de forma gradual.</p>
${flow([['Paso 1','ReplicaSet v1 con todos los Pods en la versión antigua'],['Paso 2','se crea el ReplicaSet v2'],['Paso 3','Pods v2 suben uno a uno; Pods v1 terminan uno a uno'],['Paso 4','todos los Pods ejecutan v2']])}
<h3>5. Rollback</h3>
${flow([['La actualización falla'],['kubectl rollout undo','deployment/&lt;nombre&gt;'],['El Deployment vuelve','a la revisión anterior'],['Pods estables','otra vez']])}
${yaml(`kubectl rollout undo deployment/my-app
kubectl rollout history deployment/my-app`)}
<h3>6. Estrategias de despliegue</h3>
${table(['Estrategia','Cómo funciona','Nativa en Deployment'],[['<b>RollingUpdate</b>','Reemplaza Pods poco a poco, sin cortes. Es la estrategia por defecto.','Sí'],['<b>Recreate</b>','Elimina todos los Pods antiguos y después crea los nuevos (hay un corte breve).','Sí'],['<b>Blue/Green</b>','Dos entornos (azul y verde); se cambia el tráfico de uno a otro.','No: se monta con dos Deployments y un Service o Ingress']])}
${yaml(`apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
spec:
  replicas: 3
  selector:
    matchLabels:
      app: myapp
  strategy:
    type: RollingUpdate
  template:
    metadata:
      labels:
        app: myapp
    spec:
      containers:
        - name: myapp
          image: nginx:1.27`)}
<h3>7. Comandos útiles</h3>
${cmds([['kubectl get deployments','Lista los Deployments','kubectl get deployments'],['kubectl get rs','Lista los ReplicaSets','kubectl get rs'],['kubectl create deployment &lt;nombre&gt; --image=&lt;imagen&gt;','Crea un Deployment','kubectl create deployment myapp --image=nginx'],['kubectl describe deployment &lt;nombre&gt;','Muestra el detalle','kubectl describe deployment myapp'],['kubectl scale deployment &lt;nombre&gt; --replicas=&lt;n&gt;','Cambia el número de réplicas','kubectl scale deployment myapp --replicas=5'],['kubectl set image deployment/&lt;nombre&gt; &lt;contenedor&gt;=&lt;imagen&gt;','Cambia la imagen (lanza un rolling update)','kubectl set image deployment/myapp myapp=nginx:1.27'],['kubectl rollout status deployment/&lt;nombre&gt;','Sigue el progreso del despliegue','kubectl rollout status deployment/myapp'],['kubectl rollout undo deployment/&lt;nombre&gt;','Vuelve a la versión anterior','kubectl rollout undo deployment/myapp']])}`],

['services','Services',`
<h3>1. ¿Por qué Services?</h3>
${two(`<p>Los Pods son <b>efímeros</b>: se crean, se destruyen y se recrean, y su IP cambia. Un Service ofrece una <b>IP y un nombre DNS estables</b> para acceder a un grupo de Pods, seleccionados por etiquetas, y reparte el tráfico entre ellos.</p>`,fan([['Cliente'],['Service','IP y DNS estables']],[['Pod'],['Pod'],['Pod']]))}
<h3>2. Tipos de Service</h3>
${table(['Tipo','Uso','Accesible desde','Descripción'],[['<b>ClusterIP</b>','Comunicación interna','Dentro del clúster','Tipo por defecto. Expone el Service en una IP interna del clúster.'],['<b>NodePort</b>','Exponer en cada nodo','Fuera del clúster (IP del nodo:puerto)','Abre un puerto estático (30000–32767) en cada nodo.'],['<b>LoadBalancer</b>','Exponer a tráfico externo','Fuera del clúster (balanceador de la nube)','Pide al proveedor de nube un balanceador externo.'],['<b>ExternalName</b>','Apuntar a un dominio externo','Dentro del clúster','Devuelve un registro DNS (CNAME) hacia un nombre externo.']])}
<h3>3. Diagramas por tipo</h3>
<div class="svc-grid">
${fan([['Cliente','dentro del clúster'],['Service','ClusterIP']],[['Pod'],['Pod']])}
${fan([['Cliente','fuera del clúster'],['IP del nodo','puerto NodePort'],['Service','NodePort']],[['Pod'],['Pod']])}
${fan([['Cliente','fuera del clúster'],['Balanceador','de la nube'],['Service','LoadBalancer']],[['Pod'],['Pod']])}
<div class="fan">${box('Cliente','dentro del clúster')}${down}${box('Service','ExternalName')}${down}${box('external-domain.com','','ext')}</div>
</div>
<h3>4. Ejemplo: Service ClusterIP</h3>
${two(table(['Campo','Valor'],[['Nombre','my-service'],['Tipo','ClusterIP'],['IP del clúster','10.96.0.15 (asignada automáticamente)'],['Puerto','80'],['Puerto de destino (targetPort)','8080']]),`<p>Un cliente dentro del clúster accede a <code>my-service:80</code> y el tráfico se reparte entre los Pods en el puerto 8080.</p>${yaml(`apiVersion: v1
kind: Service
metadata:
  name: my-service
spec:
  type: ClusterIP
  selector:
    app: myapp
  ports:
    - port: 80
      targetPort: 8080`)}`)}`],

['configmaps-secrets','ConfigMaps y Secrets',`
<h3>1. ConfigMap: ¿para qué?</h3>
${two(`<div><p>Un ConfigMap guarda <b>configuración no sensible</b> en pares clave-valor. Permite separar la configuración de la imagen del contenedor.</p><p>Casos de uso:</p>${list(['Configuración de la aplicación','Variables de entorno','Argumentos de línea de comandos','Ficheros de configuración'])}</div>`,`<div class="fan">${box('ConfigMap','app.properties · db.url · log.level')}${down}${box('Pod / Aplicación','consume la configuración')}</div>`)}
<h3>2. Secret: ¿para qué?</h3>
${two(`<div><p>Un Secret guarda <b>datos sensibles</b>: contraseñas, tokens, claves o certificados.</p><p>Casos de uso:</p>${list(['Contraseñas','Claves de API','Tokens OAuth','Certificados TLS'])}</div>`,`<div class="fan">${box('Secret','username · password · token')}${down}${box('Pod / Aplicación','consume el secreto')}</div>`)}
${fix('Los valores de un Secret se guardan codificados en <b>Base64, que no es cifrado</b>: cualquiera que pueda leer el Secret puede decodificarlo. Un Secret solo es "más seguro" que un ConfigMap si lo proteges con RBAC (quién puede leerlo) y activas el <b>cifrado en reposo</b> de etcd, que no está activado por defecto.')}
<h3>3. ConfigMap frente a Secret</h3>
${table(['Característica','ConfigMap','Secret'],[['Tipo de datos','No sensibles','Sensibles'],['Codificación','Texto plano','Base64 (no es cifrado)'],['Propósito','Configuración','Contraseñas, claves, certificados'],['Protección','Ninguna especial','RBAC más restrictivo y cifrado en reposo opcional'],['Ejemplo','app.properties, URLs, feature flags','db-password, certificados TLS']])}
<h3>4. Cómo los usa un Pod</h3>
<div class="fan"><div class="fan-kids top">${box('ConfigMap','clave=valor')}${box('Secret','clave=valor')}</div>${down}<div class="pod-box"><b>Pod</b><div class="pod-cts"><span>Variables de entorno</span><span>Volumen montado (ficheros)</span></div></div></div>
${yaml(`apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
data:
  LOG_LEVEL: info
---
# En el contenedor del Pod:
envFrom:
  - configMapRef:
      name: app-config
  - secretRef:
      name: app-secret`)}
<h3>5. Puntos importantes</h3>
${list(['ConfigMaps y Secrets desacoplan la configuración de la aplicación.','Los Secrets no se cifran por defecto en etcd: activa el cifrado en reposo.','Ambos pueden usarse como variables de entorno o montarse como volumen dentro del Pod.','Nunca guardes Secrets en el repositorio en texto plano.'])}`],

['volumenes','Volúmenes y almacenamiento',`
<h3>1. ¿Por qué volúmenes?</h3>
${two(`<p>Los contenedores son <b>efímeros</b>: si un contenedor se elimina, se pierden los datos guardados dentro. Los volúmenes ofrecen almacenamiento que sobrevive a los reinicios del contenedor; con volúmenes persistentes, también a la eliminación del Pod.</p>`,`<div class="fan"><div class="pod-box"><b>Pod</b><div class="pod-cts"><span>Contenedor · /app/data</span></div></div>${down}${box('Volumen','los datos persisten')}</div>`)}
<h3>2. Tipos de volumen</h3>
${two(table(['Tipo','Descripción'],[['<code>emptyDir</code>','Temporal; se borra cuando se elimina el Pod.'],['<code>hostPath</code>','Monta un fichero o carpeta del nodo.'],['<code>nfs</code>','Monta un recurso compartido NFS.'],['<code>configMap</code>','Monta un ConfigMap como ficheros.'],['<code>secret</code>','Monta un Secret como ficheros.'],['<code>persistentVolumeClaim</code>','Usa almacenamiento persistente (PV).']]),note('Recomendaciones',list(['emptyDir para datos temporales.','hostPath con precaución: ata el Pod a un nodo y es un riesgo de seguridad.','PVC para cargas de producción.']),'dashed'))}
<h3>3. Almacenamiento persistente: PV y PVC</h3>
${list(['<b>PV (PersistentVolume):</b> una pieza de almacenamiento del clúster, aprovisionada por un administrador o de forma dinámica.','<b>PVC (PersistentVolumeClaim):</b> una solicitud de almacenamiento hecha por un usuario. Se vincula (<i>bind</i>) a un PV adecuado.'])}
${flow([['El Pod pide almacenamiento'],['PVC','solicitud'],['Se vincula a un PV','almacenamiento real'],['El Pod lo usa']])}
<h3>4. StorageClass</h3>
${two(`<p>Una StorageClass describe la <b>"clase" de almacenamiento</b> que quieres y permite el <b>aprovisionamiento dinámico</b> de PVs.</p>`,table(['Ejemplo','Uso'],[['<code>fast-ssd</code>','Alto rendimiento'],['<code>standard</code>','Uso general'],['<code>slow-hdd</code>','Copias de seguridad, logs']]))}
<h3>5. Flujo de almacenamiento dinámico</h3>
${flow([['Administrador','crea la StorageClass'],['Usuario','crea el PVC'],['Aprovisionador dinámico','crea el PV automáticamente'],['El PVC se vincula al PV'],['El Pod usa el almacenamiento']])}
${note('Nota','<p>Si no hay StorageClass, el PV debe crearse manualmente (aprovisionamiento estático). Se recomienda el aprovisionamiento dinámico.</p>','dashed')}
${yaml(`apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: my-pvc
spec:
  accessModes: ["ReadWriteOnce"]
  storageClassName: standard
  resources:
    requests:
      storage: 5Gi`)}
<h3>6. Comandos útiles</h3>
${cmds([['kubectl get pv','Lista los PersistentVolumes','kubectl get pv'],['kubectl get pvc','Lista los PersistentVolumeClaims','kubectl get pvc'],['kubectl describe pvc &lt;nombre&gt;','Muestra el detalle de un PVC','kubectl describe pvc my-pvc'],['kubectl delete pvc &lt;nombre&gt;','Elimina un PVC','kubectl delete pvc my-pvc'],['kubectl get storageclass','Lista las StorageClasses','kubectl get storageclass'],['kubectl describe storageclass &lt;nombre&gt;','Muestra el detalle de una StorageClass','kubectl describe storageclass fast-ssd']])}`],

['namespaces-ingress','Namespaces e Ingress',`
<h3>1. Namespaces</h3>
${two(`<div><p>Un namespace permite <b>dividir los recursos del clúster</b> entre usuarios, equipos o entornos.</p>${list(['El namespace por defecto se llama <code>default</code>.','Ayuda a organizar recursos y a aplicar cuotas y permisos.','Los nombres de recursos deben ser únicos dentro de un namespace, no entre namespaces.'])}</div>`,`<div class="ns-grid">${['Namespace 1','Namespace 2','Namespace N'].map(n=>`<div class="ns"><b>${n}</b><div class="mini">Pod · Pod · Pod</div><div class="mini">Service</div><div class="mini">Otros recursos</div></div>`).join('')}</div>`)}
${fix('Un namespace <b>no aísla la red</b> por sí solo: por defecto, un Pod del namespace 1 <b>sí puede</b> comunicarse con uno del namespace 2 (por ejemplo, con <code>mi-servicio.namespace2.svc.cluster.local</code>). Para aislarlos hacen falta <b>NetworkPolicies</b>, y RBAC para limitar quién ve qué.')}
<h3>2. Ingress: ¿para qué?</h3>
${two(`<p>Un Service LoadBalancer o NodePort expone aplicaciones, pero un Ingress ofrece un <b>enrutamiento más potente</b> (por host o por ruta) usando un <b>único punto de entrada</b>.</p><h3>Puntos clave</h3>${list(['Trabaja en la capa 7 (HTTP/HTTPS).','Enrutamiento por host y por ruta.','Terminación TLS/SSL.','Necesita un Ingress Controller (p. ej., NGINX o Traefik) que aplique las reglas.'])}`,`<div class="fan">${box('Internet')}${down}${box('Ingress','reglas')}${down}${box('Service')}${down}<div class="fan-kids">${box('Pod')}${box('Pod')}${box('Pod')}</div></div>`)}
<h3>3. Ejemplo: enrutamiento por host y por ruta</h3>
${table(['Petición','Se envía a'],[['<code>app.example.com/api</code>','Service <code>api-service</code>'],['<code>app.example.com/web</code>','Service <code>web-service</code>'],['<code>admin.example.com/</code>','Service <code>admin-service</code>']])}
${yaml(`apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: app-ingress
spec:
  rules:
    - host: app.example.com
      http:
        paths:
          - path: /api
            pathType: Prefix
            backend:
              service: { name: api-service, port: { number: 80 } }
          - path: /web
            pathType: Prefix
            backend:
              service: { name: web-service, port: { number: 80 } }`)}
<h3>4. Service frente a Ingress</h3>
${table(['Característica','Service','Ingress'],[['Capa','Capa 4 (TCP/UDP)','Capa 7 (HTTP/HTTPS)'],['Enrutamiento','Básico (por puerto)','Avanzado (por host o ruta)'],['SSL/TLS','No lo gestiona','Puede terminar TLS'],['Uso','Exponer un servicio','Exponer varios servicios con reglas'],['Controlador','No necesita','Necesita Ingress Controller']])}
<h3>5. Comandos útiles</h3>
${cmds([['kubectl get ns','Lista los namespaces',''],['kubectl get ingress -A','Lista los Ingress de todos los namespaces',''],['kubectl describe ingress &lt;nombre&gt;','Muestra el detalle de un Ingress','kubectl describe ingress app-ingress'],['kubectl apply -f ingress.yaml','Crea o actualiza un Ingress desde YAML',''],['kubectl delete ingress &lt;nombre&gt;','Elimina un Ingress','kubectl delete ingress app-ingress']])}
${short('los namespaces organizan el clúster; el Ingress enruta de forma inteligente el tráfico hacia los Services.')}`],

['recursos-probes','Recursos, etiquetas y probes',`
<h3>1. Requests y limits de recursos</h3>
${table(['','Qué significa'],[['<b>Requests</b>',list(['Recursos mínimos que necesita el contenedor.','El scheduler los usa para decidir en qué nodo colocar el Pod.','Si no se definen, la planificación puede ser mala.'])],['<b>Limits</b>',list(['Máximo de recursos que puede usar un contenedor.','Evitan que un contenedor acapare todo el nodo.','Si se supera la CPU, se limita (<i>throttling</i>); si se supera la memoria, el contenedor se termina (OOMKilled).'])]])}
${yaml(`resources:
  requests:
    cpu: "250m"
    memory: "128Mi"
  limits:
    cpu: "500m"
    memory: "256Mi"`)}
<h3>2. Tipos de nodo</h3>
${list(['<b>Nodo del plano de control:</b> gestiona el clúster y toma decisiones globales.','<b>Nodo de trabajo:</b> ejecuta los Pods de las aplicaciones.','<b>etcd:</b> almacena todos los datos del clúster. Suele ejecutarse en los nodos del plano de control, aunque puede estar en nodos dedicados.'])}
<h3>3. Etiquetas comunes</h3>
<p>Las etiquetas (<i>labels</i>) son pares clave-valor que sirven para organizar y seleccionar recursos (por ejemplo, un Service selecciona sus Pods por etiquetas).</p>
${table(['Etiqueta','Significado'],[['<code>app</code>','Nombre de la aplicación'],['<code>env</code>','Entorno (dev, test, prod)'],['<code>tier</code>','Capa (frontend, backend)'],['<code>version</code>','Versión de la aplicación'],['<code>team</code>','Equipo responsable']])}
<h3>4. Health checks (probes)</h3>
${table(['Probe','Pregunta que responde','Si falla…'],[['<b>Liveness</b>','¿El contenedor sigue sano?','Kubernetes reinicia el contenedor.'],['<b>Readiness</b>','¿Está listo para recibir tráfico?','Se saca del Service hasta que vuelva a estar listo.'],['<b>Startup</b>','¿Ha terminado de arrancar la aplicación?','Retrasa las otras probes; si no arranca a tiempo, se reinicia.']])}
${yaml(`livenessProbe:
  httpGet:
    path: /healthz
    port: 8080
  periodSeconds: 10
readinessProbe:
  httpGet:
    path: /ready
    port: 8080`)}`],

['kubectl','Chuleta de kubectl',`
<p>Los comandos más útiles del día a día, agrupados.</p>
<h3>Consultar el clúster</h3>
${cmds([['kubectl get pods','Lista los Pods',''],['kubectl get svc','Lista los Services',''],['kubectl get nodes','Lista los nodos',''],['kubectl get all -n &lt;namespace&gt;','Lista los recursos principales de un namespace','kubectl get all -n dev'],['kubectl describe pod &lt;pod&gt;','Detalle y eventos de un Pod','kubectl describe pod web-7d9f'],['kubectl logs &lt;pod&gt;','Logs de un Pod','kubectl logs web-7d9f -f']])}
<h3>Trabajar con recursos</h3>
${cmds([['kubectl apply -f &lt;fichero&gt;.yaml','Crea o actualiza recursos desde YAML','kubectl apply -f deployment.yaml'],['kubectl delete -f &lt;fichero&gt;.yaml','Elimina los recursos del fichero',''],['kubectl exec -it &lt;pod&gt; -- /bin/sh','Abre una shell dentro de un Pod','kubectl exec -it web-7d9f -- /bin/sh'],['kubectl port-forward svc/&lt;svc&gt; 8080:80','Reenvía un puerto local al Service','kubectl port-forward svc/my-service 8080:80']])}
${note('Consejo','<p>Usa <code>/bin/sh</code> si la imagen no incluye <code>/bin/bash</code> (muchas imágenes ligeras no lo traen). Y <code>kubectl explain &lt;recurso&gt;</code> muestra la documentación de cualquier campo YAML.</p>','dashed')}`]
];

window.renderK8sDocs=(app,tabs)=>{
  const target=location.hash.split('/')[2];
  app.innerHTML=`<a class="back" href="#inicio">← Todas las rutas</a><p class="eyebrow">ORQUESTACIÓN DE CONTENEDORES</p><h1>Kubernetes</h1><p class="intro">Apuntes de Kubernetes explicados en palabras sencillas, con diagramas y ejemplos. Ideales para repasar rápido y preparar entrevistas.</p>${tabs}
<div class="docs"><div class="docs-main">${sections.map(([id,t,body],i)=>`<section class="doc-section" id="doc-${id}"><p class="eyebrow">CAPÍTULO ${String(i+1).padStart(2,'0')}</p><h2>${t}</h2>${body}</section>`).join('')}
<p class="bottom-note">Las notas marcadas con ✎ precisan o actualizan información que suele explicarse de forma simplificada.</p></div>
<div class="docs-toc"><div class="lesson"><h3>Contenido</h3><ol>${sections.map(([id,t])=>`<li><a href="#kubernetes/docs/${id}" data-doc="${id}">${t}</a></li>`).join('')}</ol></div></div></div>`;
  const links=[...app.querySelectorAll('[data-doc]')];
  links.forEach(a=>a.onclick=e=>{e.preventDefault();history.replaceState(null,'',a.getAttribute('href'));document.getElementById(`doc-${a.dataset.doc}`).scrollIntoView({behavior:'smooth',block:'start'})});
  if('IntersectionObserver' in window){
    const io=new IntersectionObserver(es=>es.forEach(en=>{if(en.isIntersecting)links.forEach(a=>a.classList.toggle('active',`doc-${a.dataset.doc}`===en.target.id))}),{rootMargin:'-20% 0px -70% 0px'});
    app.querySelectorAll('.doc-section').forEach(s=>io.observe(s));
  }
  const el=target&&document.getElementById(`doc-${target}`);
  if(el)requestAnimationFrame(()=>el.scrollIntoView({block:'start'}));
};
})();
