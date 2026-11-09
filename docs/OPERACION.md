# Manual técnico y DevOps

## Requisitos

- Git y Node.js 20 o superior con npm. Alternativamente Bun 1.1 o superior.
- No se requieren credenciales ni claves: el demo no llama APIs de IA, correo, nube ni bases de datos externas.
- Para datos reales hacen falta autorización del dueño de datos, almacenamiento protegido, control de acceso y una política de retención; este demo no proporciona esos controles.

## Clonar y arrancar

```sh
git clone https://github.com/nicofolo-ey-git/peri-proj.git
cd peri-proj
npm install
npm run dev:api
```

En una segunda terminal:

```sh
npm run dev:web
```

Abrir la dirección local indicada por Vite (habitualmente `http://127.0.0.1:5173`). La API queda en `http://127.0.0.1:3001`. Comprobarla con `curl http://127.0.0.1:3001/api/health`.

Con Bun, instalar con `bun install`; iniciar `bun run dev:api`, `bun run dev:web` y `bun run demo`. La ejecución de TypeScript es directa y el código usa módulos compatibles con Node 20/Bun.

## Comandos

| Comando | Acción |
|---|---|
| `npm run demo` | Procesa de forma determinista los seis JSON sintéticos del buzón |
| `npm test` | Ejecuta pruebas unitarias |
| `npm run typecheck` | Verifica TypeScript |
| `npm run build` | Verifica tipos, genera el cliente web en `dist/` y API en `dist-server/` |
| `npm run dev:api` | API local con recarga de desarrollo |
| `npm run dev:web` | Cliente web con proxy local al API |

Comandos de la interfaz: `/buscar <texto>`, `/contrato <ID>`, `/vencen`, `/proponer <ID> owner <nombre>`, `/proponer <ID> status <active|pending|expired>` y `/proponer <ID> end_date <AAAA-MM-DD>`.

## Configuración y secretos

`PORT` (por defecto `3001`) cambia el puerto local del API. El host está fijado a `127.0.0.1` deliberadamente. No crear un `.env` con secretos para este prototipo. Si se agrega un proveedor o despliegue, guardar secretos en el gestor de secretos del entorno, nunca en Git, fixtures, logs o frontend.

El archivo de datos de aprobación `fixtures/reto-02/aprobados.jsonl` se crea al aprobar una propuesta. Está ignorado por Git para evitar que datos operativos salgan del entorno. Mantener el log en almacenamiento protegido, con backups y retención aprobada si se usa fuera de esta demo. El API solo acepta aprobaciones web desde los orígenes locales de Vite incluidos en el demo; al desplegar detrás de un reverse proxy, configurar una lista de orígenes segura en vez de eliminar la verificación.

## Entrega reproducible y despliegue

1. Revisar cambios de dependencias y usar una versión Node 20+ soportada.
2. Instalar dependencias de lockfile y ejecutar `npm run typecheck`, `npm run demo` y `npm run build`.
3. Empaquetar artefactos desde un checkout revisado; servir `dist/` con un servidor web y ejecutar `npm start` desde la raíz como servicio no privilegiado en red privada.
4. Antes de habilitar tráfico, implementar autenticación/autorización, TLS, límites y validación de archivos, protección CSRF/CORS adecuada, auditoría con identidad verificable, almacenamiento transaccional, monitoreo y recuperación.
5. Sustituir solo con fixtures autorizados, comprobar esquema/encoding y fijar una fecha de corte real. No cargar correo/documentos automáticamente sin política y aprobación.

No existe despliegue configurado ni una URL pública en vivo. El servidor API y cliente se compilan por separado; sirven a través de un servidor web y reverse proxy que dirija `/api` al servicio local. No exponer esta demo a Internet: carece de autenticación y controles de producción.

## Diagnóstico y rollback

- Errores de schema: comparar headers del CSV con `src/tools/contratos.ts`, corregir en una copia aprobada y no sobrescribir la evidencia original.
- Puerto ocupado: definir `PORT` a un puerto libre y actualizar el proxy de Vite durante desarrollo.
- Una aprobación confirmada es append-only. Para revertirla no editar el snapshot; acordar con dueño de datos un evento compensatorio auditado y adaptar la lógica antes de uso real.
