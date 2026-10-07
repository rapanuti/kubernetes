# Cloud Lab
Portal de estudio en español de Kubernetes y Azure. Sitio estático sin compilación ni dependencias: inicio, teoría, práctica y espacio para el futuro proyecto de examen.

## Desarrollo local
Desde este directorio:

```sh
python3 -m http.server 4173 --directory dist
```

Abre http://localhost:4173. El contenido vive en `dist/app.js`, el diseño en `dist/style.css` y la estructura en `dist/index.html`. Las rutas usan hashes. El progreso se guarda únicamente en localStorage del navegador. Los ejercicios son cuestionarios: no ejecutan comandos ni crean recursos cloud. La animación respeta la preferencia de movimiento reducido.
