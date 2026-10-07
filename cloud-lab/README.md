# Cloud Lab
Portal de estudio en español de Kubernetes y Azure. Sitio estático sin compilación ni dependencias: inicio, teoría, práctica, documentación de Kubernetes y simulador de examen AZ-900.

## Desarrollo local
Desde este directorio:

```sh
python3 -m http.server 4173 --directory dist
```

Abre http://localhost:4173. El contenido vive en `dist/app.js`, la documentación de Kubernetes en `dist/k8s-docs.js`, el simulador AZ-900 en `dist/exam.js` con su banco de 160 preguntas en `dist/az900-data.js`, el diseño en `dist/style.css` y la estructura en `dist/index.html`. Las rutas usan hashes. El progreso se guarda únicamente en localStorage del navegador. Los ejercicios son cuestionarios: no ejecutan comandos ni crean recursos cloud. La animación respeta la preferencia de movimiento reducido.
