# Cloud Lab
Portal de estudio en español de Kubernetes y Azure. Sitio estático sin compilación ni dependencias: inicio, teoría, práctica con terminal de Kubernetes simulada, documentación de Kubernetes y simulador de examen AZ-900.

## Desarrollo local
Desde este directorio:

```sh
python3 -m http.server 4173 --directory dist
```

Abre http://localhost:4173. El contenido vive en `dist/app.js`, la documentación de Kubernetes en `dist/k8s-docs.js`, el simulador AZ-900 en `dist/exam.js` con su banco de 160 preguntas en `dist/az900-data.js`, el diseño en `dist/style.css` y la estructura en `dist/index.html`. Las rutas usan hashes. El progreso se guarda únicamente en localStorage del navegador. Los ejercicios son cuestionarios: no ejecutan comandos ni crean recursos cloud. La animación respeta la preferencia de movimiento reducido.

## Terminal de Kubernetes simulada
En `#kubernetes/practica` hay una terminal (xterm.js) conectada a un clúster minikube simulado (Kubernetes v1.37.1). Nada se ejecuta de verdad: `dist/lab/k8s-engine.js` mantiene el estado (nodos, namespaces, Deployments, ReplicaSets, Pods, Services, ConfigMaps, Secrets y eventos), interpreta `kubectl`, `minikube` y una mini shell (tuberías, `&&`, redirecciones y heredocs) y devuelve salidas y errores con el formato de kubectl. `dist/lab/k8s-lab.js` dibuja la terminal, el mapa del clúster y los retos guiados. El estado se guarda en localStorage y caduca tras 48 h sin uso (`lab reset` lo reinicia).

Dependencias incluidas en `dist/vendor/` (licencia MIT): @xterm/xterm 6.0.0, @xterm/addon-fit 0.11.0 y js-yaml 5.4.3. Se cargan solo al abrir la práctica de Kubernetes.

Pruebas rápidas del motor con Node:

```sh
node -e "const y=require('./dist/vendor/js-yaml.js');const s=require('./dist/lab/k8s-engine.js').create({yaml:y});console.log(s.run('kubectl create deploy web --image=nginx --replicas=3').out)"
```
