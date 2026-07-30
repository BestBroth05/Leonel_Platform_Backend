# Leonel Platform — Contexto base y solicitud de planificación

Plataforma de administración operativa para el taller familiar.

> **Nombrado:** el producto oficial es **Leonel Platform** (repositorio `leonel-platform`). En borradores tempranos de planificación se usó el nombre provisional “Leonel's Iron”; ese nombre ya no aplica al producto de software.

## Instrucción principal para Cursor

Construye una aplicación web en **React** (**Leonel Platform**) para administrar la operación del taller familiar.

Antes de escribir código, trabaja en **modo Plan**. Lee completamente este archivo, analiza el dominio y genera un plan de implementación por fases. No empieces a programar hasta haber definido y presentado:

1. Alcance de cada fase.
2. Entidades y relaciones necesarias.
3. Reglas de negocio pendientes de confirmar.
4. Arquitectura propuesta para frontend, backend e infraestructura.
5. Contratos principales entre frontend y backend.
6. Estrategia de autenticación, autorización y auditoría.
7. Riesgos, dependencias y decisiones abiertas.
8. Orden recomendado de implementación.
9. Criterios de aceptación de cada fase.

No copies la arquitectura ni el código del proyecto Flutter anterior. El proyecto anterior sirve únicamente como referencia funcional parcial del dominio.

---

# 1. Objetivo del producto

Leonel Platform será un sistema para facilitar la administración de un pequeño taller dedicado al proceso final del pantalón antes de enviarlo a tiendas o centros de distribución.

El taller realiza actividades como:

- Recepción de pantalones.
- Planchado.
- Endosenado.
- Etiquetado.
- Correcciones o composturas.
- Control de faltantes y mermas.
- Empaque en cajas.
- Distribución de cajas por destino.
- Entregas completas o parciales.
- Control de trabajadores.
- Cálculo de horas normales y horas extra.
- Registro de gastos.
- Reportes operativos y financieros.
- En una fase posterior, captura y consulta mediante voz e inteligencia artificial.

Actualmente gran parte de esta información se controla con libretas y memoria. La aplicación debe reducir errores, conservar historial y permitir conocer el estado real de cada pedido.

---

# 2. Tecnologías objetivo

## Frontend

- React.
- TypeScript.
- Aplicación web responsiva.
- Arquitectura por features y por capas.
- Componentes reutilizables.
- Formularios, tablas, filtros, paginación y dashboards.
- Preparada para crecer sin mezclar lógica de negocio con componentes visuales.

## Backend

- Node.js.
- TypeScript.
- API modular.
- Arquitectura por features y por capas.
- Separación entre dominio, casos de uso, infraestructura y capa de entrada.
- Validaciones y reglas de negocio en el backend.
- Persistencia mediante una base de datos relacional.

## Infraestructura

- AWS.
- La infraestructura exacta se decidirá durante la planificación.
- Debe priorizar bajo costo, seguridad, respaldos y facilidad de mantenimiento.
- El sistema comenzará con pocos usuarios, pero deberá poder crecer.

## Inteligencia artificial y voz

Se implementará al final, después de estabilizar los módulos principales.

La intención futura es permitir instrucciones como:

- “Llegaron 3,250 pantalones del cliente X, pedido 245”.
- “Se mandaron 15 pantalones a compostura”.
- “Salieron 2,000 piezas para determinado destino”.
- “José llegó a las 7:20”.
- “José salió a las 18:40 e hizo dos horas extra”.
- “Gasté 500 pesos de gasolina”.
- “¿Cuántas piezas quedan del pedido 245?”.
- “¿Cuánto se le debe pagar a José esta semana?”.

La IA no deberá modificar información sensible sin validación, confirmación y trazabilidad.

---

# 3. Arquitectura esperada

La arquitectura definitiva se deberá definir en la fase de planificación, pero debe respetar los siguientes principios.

## Frontend React

Organización principal por features, por ejemplo:

- auth
- users
- clients
- orders
- inventory
- workers
- payroll
- expenses
- reports
- voice-assistant

Cada feature deberá separar, de manera pragmática:

- Presentación.
- Estado y coordinación de la interfaz.
- Casos de uso o servicios de aplicación.
- Modelos y reglas del dominio.
- Acceso a API e infraestructura.

También deberá existir una zona compartida para:

- Design system.
- Componentes genéricos.
- Configuración.
- Cliente HTTP.
- Manejo de errores.
- Autenticación.
- Utilidades comunes.

No crear abstracciones innecesarias. La separación debe ayudar a mantener y probar el sistema.

## Backend Node.js

Organización modular por features. Cada módulo deberá contemplar, cuando aplique:

- Dominio.
- Entidades y value objects.
- Casos de uso.
- Puertos o interfaces.
- Repositorios.
- Infraestructura.
- Controladores o handlers HTTP.
- DTOs y validaciones.
- Políticas de autorización.
- Pruebas.

Evitar:

- Controladores con lógica de negocio.
- Repositorios acoplados a la capa HTTP.
- Modelos de base de datos utilizados directamente como modelos de dominio.
- Archivos monolíticos.
- Dependencias circulares entre módulos.

## Principios generales

- Modularidad.
- Bajo acoplamiento.
- Alta cohesión.
- Trazabilidad de cambios.
- Auditoría de movimientos.
- Validaciones en frontend y backend.
- Idempotencia para movimientos críticos.
- Estados explícitos.
- Historial en lugar de sobrescribir datos importantes.
- Seguridad por defecto.
- Preparación para múltiples talleres en el futuro, sin sobrecomplicar el MVP.

---

# 4. Hallazgos útiles del proyecto Flutter anterior

El proyecto Flutter anterior contiene una implementación parcial. Lo útil como referencia es lo siguiente.

## Entidades identificadas

### Cliente

Campos existentes:

- clienteId
- nombre
- rfc
- telefono
- direccion
- semanaInicio
- semanaFin
- diaPagoPreferido

Relación conocida:

- Un cliente puede tener varios cortes o pedidos.

### Corte

En el sistema anterior se utilizaba el término **Corte** como unidad operativa principal. Durante la nueva definición del dominio se deberá decidir si el nombre correcto será:

- Corte.
- Pedido.
- Lote.
- Orden de trabajo.

Campos existentes:

- corteId
- numeroCorte
- descripcion
- clienteId
- marcaId
- tipoId
- modalidad
- planchadoIncluido
- cantidadTotalPzas
- statusGlobal
- fechaCreacion

### Marca

Campos existentes:

- marcaId
- nombre
- logoUrl

### Tipo de pantalón o categoría

Campos existentes:

- tipoId
- categoria

### Usuario

Campos existentes:

- id
- name
- email
- userType
- typeString
- token

El modelo anterior solo reconocía explícitamente al administrador. Los roles definitivos deberán redefinirse.

## Flujo parcial observado

El proyecto anterior únicamente alcanzaba a representar:

Cliente  
→ Corte o pedido  
→ Marca  
→ Tipo de pantalón  
→ Cantidad total  
→ Planchado incluido  
→ Estado global

No existe un flujo completo de recepción, producción, reparación, empaque, distribución y salida.

## Funcionalidad que sí existía parcialmente

- Login y logout.
- Persistencia de token.
- Listado paginado de clientes.
- Alta y edición de clientes.
- Listado paginado de cortes.
- Alta parcial de cortes.
- Menú para tablero, cortes, pagos, marcas, clientes y categorías.
- Componentes de tablas, filtros, formularios, botones y paginación.

Estas funcionalidades sirven como referencia de necesidades, no como implementación que deba copiarse.

---

# 5. Elementos del proyecto anterior que no deben reutilizarse

No conservar como base:

- La arquitectura actual del proyecto Flutter.
- Los nombres inconsistentes de archivos y componentes.
- La lógica de autenticación existente.
- Los modelos actuales como diseño definitivo.
- Los filtros heredados de otros sistemas.
- Roles como Instalador o Técnico.
- Mensajes que hablan de usuarios dentro de formularios de cortes.
- El uso de IDs numéricos en lugar de nombres visibles.
- Pantallas placeholder.
- Lógica duplicada.
- Componentes duplicados.
- Bugs funcionales.
- Estados almacenados como texto libre sin catálogo o máquina de estados.

Problemas detectados:

- La aplicación abría directamente en Clientes sin respetar el login.
- El botón Nuevo de Clientes abría el formulario de Corte.
- Editar Corte volvía a ejecutar creación.
- Dirección del cliente estaba conectada al controlador de teléfono.
- Los dropdowns de cliente, marca y tipo no cargaban datos.
- No había selector claro para statusGlobal.
- Tablero, Pagos, Marcas y Categorías estaban incompletos.
- Había código residual de otros dominios.

---

# 6. Dominio que falta modelar

El nuevo diseño deberá incorporar conceptos que no existen en el proyecto anterior.

## Pedidos y operación

- Cliente.
- Pedido, corte, lote u orden de trabajo.
- Recepción de piezas.
- Cantidad esperada.
- Cantidad recibida.
- Recepción completa o incompleta.
- Faltantes de recepción.
- Entradas adicionales posteriores.
- Piezas procesadas.
- Piezas enviadas a arreglo o compostura.
- Piezas recuperadas de arreglo.
- Merma o saldo.
- Piezas pendientes.
- Salidas parciales.
- Salida completa.
- Destinos.
- Cajas.
- Cantidad por caja.
- Distribución de cajas por destino.
- Historial de movimientos.
- Evidencias, notas y responsables.

## Inventario

No debe modelarse únicamente como un número editable.

Debe existir un libro de movimientos que permita explicar:

- Qué entró.
- Qué salió.
- Qué se corrigió.
- Qué se perdió.
- Qué se envió a reparación.
- Qué regresó.
- Quién registró el movimiento.
- Cuándo ocurrió.
- A qué pedido perteneció.
- Qué saldo dejó.

## Trabajadores

- Datos generales.
- Estatus activo o inactivo.
- Tipo de pago.
- Tarifa por hora o jornada.
- Tarifa de hora extra.
- Hora de entrada.
- Hora de salida.
- Descansos.
- Faltas.
- Retardos.
- Horas normales.
- Horas extra.
- Ajustes manuales autorizados.
- Historial de asistencia.

## Nómina básica

- Periodos de pago.
- Horas normales.
- Horas extra.
- Faltas o descuentos.
- Bonos o ajustes.
- Total calculado.
- Total autorizado.
- Estado del pago.
- Evidencia o notas.

La aplicación apoyará el cálculo interno del taller. Las reglas fiscales o laborales formales no están definidas en el proyecto anterior y no deben inventarse.

## Gastos

Categorías iniciales:

- Gas para plancha.
- Gasolina.
- Reparación de camioneta.
- Mantenimiento de maquinaria.
- Planchas y equipo.
- Materiales.
- Etiquetas.
- Bolsas.
- Cajas.
- Comida para trabajadores.
- Otros.

Cada gasto deberá poder registrar:

- Fecha.
- Categoría.
- Descripción.
- Monto.
- Proveedor opcional.
- Método de pago opcional.
- Pedido relacionado opcional.
- Vehículo o equipo relacionado opcional.
- Comprobante opcional.
- Usuario responsable.

## Reportes

Ejemplos esperados:

- Estado de pedidos.
- Piezas recibidas, procesadas, pendientes y entregadas.
- Faltantes y mermas.
- Entregas parciales.
- Productividad por periodo.
- Gastos por categoría.
- Gastos por pedido.
- Costos estimados.
- Pagos de trabajadores.
- Utilidad estimada.
- Pedidos próximos a entrega.
- Alertas por inconsistencias.

Las fórmulas finales deberán acordarse con los usuarios del negocio.

---

# 7. Fases de implementación

## Fase 0 — Descubrimiento y definición

Antes de desarrollar:

- Definir glosario del dominio.
- Confirmar si Corte y Pedido son lo mismo.
- Documentar el proceso real desde recepción hasta entrega.
- Definir estados y transiciones.
- Identificar roles.
- Diseñar el modelo de datos.
- Definir reglas de inventario.
- Definir auditoría.
- Definir alcance exacto del MVP.
- Elaborar wireframes o flujos principales.
- Elegir estrategia de despliegue AWS.

Entregable:

- Plan técnico y funcional aprobado.
- Modelo inicial de dominio.
- Diagrama de entidades.
- Mapa de módulos.
- Lista de decisiones abiertas.

## Fase 1 — Base de la aplicación, login y usuarios

Alcance inicial:

- Proyecto React.
- Estructura base por features y capas.
- Backend Node.js.
- Configuración por ambientes.
- Base de datos y migraciones.
- Login.
- Cierre de sesión.
- Renovación o administración segura de sesión.
- Usuarios.
- Roles y permisos básicos.
- Layout principal.
- Navegación.
- Manejo global de errores.
- Auditoría mínima.
- CI/CD inicial.
- Ambiente de desarrollo y ambiente desplegado.

Roles iniciales por confirmar:

- Administrador.
- Encargado.
- Capturista o consulta.

## Fase 2 — Clientes, pedidos e inventario

Esta es la primera fase funcional del negocio.

### Clientes

- Listado.
- Alta.
- Edición.
- Consulta.
- Activación o desactivación.
- Datos de contacto y facturación necesarios.
- Preferencias de pago, solo si siguen siendo útiles.

### Catálogos básicos

- Marcas.
- Tipos o categorías de pantalón.
- Modalidades.
- Estados definidos.
- Destinos.

### Pedidos

- Crear pedido.
- Asociarlo a cliente.
- Número de pedido o corte.
- Descripción.
- Marca.
- Tipo.
- Modalidad.
- Planchado incluido.
- Cantidad esperada.
- Fechas relevantes.
- Estado.
- Notas.

### Inventario y movimientos

- Registrar recepción.
- Registrar entradas adicionales.
- Registrar faltantes.
- Registrar reparación.
- Registrar regreso de reparación.
- Registrar merma.
- Registrar salida parcial.
- Registrar salida final.
- Consultar saldo.
- Consultar historial.
- Impedir saldos imposibles.
- Registrar usuario y fecha de cada movimiento.

## Fase 3 — Trabajadores y nómina básica

- CRUD de trabajadores.
- Configuración de tarifa.
- Registro de entrada y salida.
- Horas normales.
- Horas extra.
- Faltas.
- Ajustes.
- Periodos de pago.
- Cálculo básico.
- Autorización y cierre de periodo.
- Historial.

## Fase 4 — Gastos y reportes

- Registro de gastos.
- Categorías.
- Comprobantes.
- Gastos relacionados con pedidos.
- Gastos relacionados con vehículos o equipos.
- Dashboard.
- Reportes operativos.
- Reportes financieros internos.
- Exportación cuando sea necesaria.
- Indicadores de costos y utilidad estimada.

## Fase 5 — Voz e inteligencia artificial

- Captura de audio.
- Transcripción.
- Interpretación estructurada.
- Resolución de entidades como cliente, pedido o trabajador.
- Vista previa de la acción.
- Confirmación antes de guardar.
- Registro de la instrucción original.
- Auditoría de la acción generada.
- Preguntas en lenguaje natural.
- Respuestas basadas únicamente en datos autorizados.
- Permisos por usuario.
- Límites y control de costos.

---

# 8. Reglas y decisiones que Cursor no debe inventar

Marcar como pendientes y solicitar definición cuando sean necesarias:

- Diferencia exacta entre cliente, pedido, corte y lote.
- Estados válidos de un pedido.
- Transiciones permitidas.
- Significado exacto de modalidad.
- Qué representa merma y qué representa saldo.
- Cómo se contabiliza una pieza enviada a arreglo.
- Cuándo una salida puede superar lo procesado.
- Cómo se corrigen movimientos erróneos.
- Qué datos son obligatorios al recibir un pedido.
- Cómo se forman las cajas.
- Cómo se asignan destinos.
- Cómo se determina que un pedido está completo.
- Tarifas de trabajadores.
- Reglas de horas extra.
- Tolerancia de entrada.
- Redondeo de horas.
- Periodicidad de pago.
- Fórmula para costos.
- Fórmula para utilidad.
- Forma de cobro a clientes.
- Reglas fiscales, contables o laborales.
- Necesidad real de multi-tenant desde el MVP.

Proponer opciones y explicar trade-offs, pero no asumir una respuesta definitiva.

---

# 9. Requisitos transversales

- Todo movimiento relevante debe ser auditable.
- No eliminar físicamente movimientos operativos importantes.
- Usar desactivación o correcciones compensatorias cuando corresponda.
- Fechas almacenadas de forma consistente.
- Manejo correcto de zona horaria.
- Validaciones de cantidades.
- Operaciones críticas dentro de transacciones.
- Prevención de registros duplicados.
- Mensajes de error útiles.
- Diseño responsivo para computadora, tablet y teléfono.
- Experiencia sencilla para usuarios no técnicos.
- Acciones frecuentes con pocos pasos.
- Búsqueda, filtros y paginación.
- Backups.
- Logs.
- Gestión segura de secretos.
- HTTPS.
- Autorización en backend.
- Pruebas unitarias de reglas críticas.
- Pruebas de integración de flujos principales.

---

# 10. Primer resultado solicitado a Cursor

Después de leer este archivo, entrega un plan estructurado con:

1. Resumen del entendimiento del negocio.
2. Glosario inicial.
3. Módulos propuestos.
4. Modelo de dominio preliminar.
5. Entidades y relaciones.
6. Estados y movimientos sugeridos.
7. Preguntas críticas pendientes.
8. Arquitectura propuesta del frontend React.
9. Arquitectura propuesta del backend Node.js.
10. Estrategia de base de datos y migraciones.
11. Estrategia de autenticación y autorización.
12. Propuesta inicial de AWS con costos bajos.
13. Estrategia de CI/CD.
14. Estrategia de pruebas.
15. Plan detallado de la Fase 1.
16. Plan detallado de la Fase 2.
17. Riesgos técnicos y de negocio.
18. Criterios de aceptación.
19. Estructura inicial recomendada de repositorios y carpetas.
20. Lista de decisiones que requieren aprobación antes de programar.

En esta primera respuesta:

- No escribas componentes.
- No generes endpoints completos.
- No crees migraciones.
- No implementes infraestructura.
- No escribas código de producción.
- No modifiques el proyecto Flutter.
- No asumas que los modelos anteriores son correctos.
- No agregues módulos fuera del alcance sin justificarlo.

El objetivo es acordar primero un plan sólido y después construir la aplicación por secciones.
