# Agente conversacional de contratos

Demo local, determinista y sin proveedor LLM. Usa TypeScript con Bun o Node.js 20+, Zod para validar entradas y fixtures sintéticas claramente identificadas.

## Inicio rápido

```sh
npm install
npm run dev:api
```

En otra terminal, desde la raíz:

```sh
npm run dev:web
```

Abre la URL local que imprime Vite. Para procesar el buzón de ejemplo: `npm run demo`.

El panel acepta `/buscar texto`, `/contrato CTR-001`, `/vencen` y `/proponer CTR-001 owner Ana`. Las propuestas no modifican datos hasta que una persona use **Aprobar escritura**. La aprobación se registra en `fixtures/reto-02/aprobados.jsonl`; el CSV histórico se conserva intacto.

Consulta [SOLUCION.md](SOLUCION.md), [el manual técnico y DevOps](docs/OPERACION.md) y [la guía de negocio](docs/NEGOCIO.md). Los datos de este repositorio son inventados para la demo; no representan contratos ni comerciales reales.
