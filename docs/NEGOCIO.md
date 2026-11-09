# Guía de negocio y operación

## Qué hace la demo

Permite consultar el registro sintético congelado al 30-may-2026, revisar vencimientos de los 30 días posteriores y preparar propuestas de cambio. El asistente no interpreta correo libre con un LLM ni envía documentos a terceros. Los seis mensajes de `fixtures/reto-02/buzon` son ejemplos inventados.

## Cargar correos o documentos

1. Confirmar con el dueño de datos que existe autorización para procesar el correo/documento y que el entorno cumple confidencialidad, acceso, retención y eliminación.
2. No copiar información personal, financiera o contractual a los fixtures, commits, tickets o prompts de herramientas externas.
3. Para esta demo, convertir únicamente ejemplos sintéticos al formato JSON de `msg-001`...`msg-006` (`id`, `subject`, `body`). No hay ingesta de adjuntos, OCR ni correo conectado.
4. Para el maestro, preparar JSON comercial y CSV siguiendo las columnas y schemas documentados en código; validar integridad referencial, moneda, estados y fechas. Identificar propietario y fecha de corte.
5. Una persona revisa muestra, fuente y errores antes de autorizar un lote. No reemplazar un maestro histórico para probar.

## Confianza y revisión

El demo de consola informa confianza de intención y de cada campo extraído: alta para coincidencia directa, media para una interpretación que requiere confirmación, baja si está incompleta o ambigua. La confianza no equivale a aprobación. Si un dato no coincide claramente con el maestro, confirmar con el responsable antes de actuar.

En la interfaz, el panel “Registro de herramientas” muestra la llamada, parámetros y resultado. Revisar que el ID, campo, valor actual y valor solicitado sean correctos antes de una acción. Consultas no escriben datos.

## Aprobar o rechazar

Una solicitud de cambio genera una tarjeta pendiente, no una modificación. La persona autorizada debe pulsar **Aprobar escritura** conscientemente para registrar el evento; **Rechazar** descarta la propuesta y no escribe. No aprobar por el solo hecho de que llegó una instrucción por correo, una clasificación tenga confianza alta o el agente sugiera un cambio. Confirmar identidad/autoridad fuera de esta demo antes de aprobación.

El snapshot `maestro-contratos.csv` no se altera. El evento aprobado se agrega al log operacional JSONL y se aplica como overlay al consultar. Si se reinicia la aplicación, las propuestas pendientes desaparecen; las aprobadas persisten en el archivo local.

## Alertas de vencimiento

La lista usa un corte fijo y ventana de 30 días, exclusivamente para probar el comportamiento. No genera avisos por correo, calendario o tarea programada y no refleja fechas actuales. El dueño de negocio debe establecer frecuencia, destinatarios, calendario y escalamiento antes de adoptar alertas reales.

## Escalamiento

Escalar a Legal/Compras y al dueño de datos si la fuente es dudosa, hay desacuerdo sobre términos, fechas o autoridad, falta confianza, aparece información confidencial inesperada o la solicitud no cabe en las herramientas. El agente no reemplaza la revisión jurídica ni el sistema oficial de contratos.
