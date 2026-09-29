# Flujos de n8n

Los flujos exportados no se publican (llevan nombres de credenciales, identificadores de chat y rutas reales).
Aquí se describe qué hace cada uno y se incluye la lógica de sus nodos de código en [`code-nodes/`](code-nodes/).

| Flujo | Disparo | Qué hace |
|---|---|---|
| **Fichajes → registro horario** | Webhook (trigger de la base de datos) + cada minuto | Envía cada fichaje al sistema de registro horario. Idempotente por `id`. Sin hora si es en directo; con hora si es tardío. Avisa por Telegram al fallar. |
| **Control diario** | 9:30 y 19:00, de lunes a viernes | Pide a la base de datos el resumen (`control_fichajes()`) y envía el aviso: quién no ha fichado (por obra) y quién no cerró la jornada. |
| **Informe semanal** | Viernes tarde | Pide `informe_horas()`; resumen por Telegram y dos Excel por email. |
| **Copia nocturna** | Cada noche | Copia partes y fichajes nuevos a una hoja de cálculo (segunda copia), con cursor para no repetir. |
| **Sincronizar plantilla** | Cada 10 min + webhook + botón manual (simulación) | Lee la hoja maestra, llama a `sincronizar_plantilla()`, empareja/crea personas en el sistema de registro horario con candado anti-duplicados y avisa de lo nuevo. |

## Cadena del flujo de sincronización

```
Disparadores ──▶ Leer hoja maestra ──▶ Preparar lista ──▶ Sincronizar app (RPC)
                                                                │
        Mensaje ◀── Vincular en la app ◀── Recoger altas ◀── ¿Hay altas? ── Crear en el sistema externo
           │                                     ▲              │ (no)
           ▼                                     └──────────────┘
       Telegram                         Reservar altas (candado) ◀── Cruzar con el sistema externo
```

## Ideas que se repiten

- **La lógica vive en SQL; n8n orquesta.** Cada flujo llama a una función y reparte el resultado.
- **Simulación antes de aplicar.** Cualquier flujo que modifica datos tiene un modo que enseña el plan sin cambiar nada.
- **Solo avisar de lo nuevo.** Los avisos recuerdan lo ya comunicado (memoria del flujo) para no repetirse cada 10 minutos.
- **Fallar en abierto sin dañar.** Si una lectura externa falla, el flujo no crea nada (evita duplicados).
