# WhatsApp API - Impulsala

Una API REST para integrar WhatsApp Web con n8n y otros servicios, permitiendo enviar y recibir mensajes de WhatsApp de forma programática.

## 📋 Descripción

Esta aplicación proporciona una interfaz REST para interactuar con WhatsApp Web, utilizando la librería `whatsapp-web.js`. Permite:

- **Enviar mensajes** a números de WhatsApp específicos
- **Recibir mensajes** y reenviarlos a n8n mediante webhooks
- **Autenticación** mediante código QR
- **Monitoreo** del estado de conexión

## 🏗️ Arquitectura del Sistema

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   WhatsApp Web  │◄──►│   API Server    │◄──►│      n8n        │
│   (Cliente)     │    │   (Node.js)     │    │   (Webhook)     │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                              │
                              ▼
                       ┌─────────────────┐
                       │   Clientes      │
                       │   (REST API)    │
                       └─────────────────┘
```

## 🔄 Flujo de Funcionamiento

### 1. Inicialización del Servidor

```javascript
// Puerto por defecto: 3000
// Configuración de Puppeteer para headless mode
// Inicialización del cliente WhatsApp
```

### 2. Proceso de Autenticación

1. **Generación de QR**: El servidor genera un código QR único
2. **Escaneo**: El usuario escanea el QR desde WhatsApp móvil
3. **Autenticación**: WhatsApp Web se conecta automáticamente
4. **Persistencia**: La sesión se guarda localmente para futuras conexiones

### 3. Flujo de Mensajes Entrantes

```
WhatsApp → API Server → n8n Webhook
   ↓           ↓           ↓
Mensaje    Procesamiento   Automatización
Recibido   + Metadata      + Respuestas
```

**Datos enviados a n8n:**

```json
{
  "from": "1234567890@c.us",
  "body": "Hola mundo",
  "timestamp": 1234567890,
  "isGroup": false,
  "contact": {
    "name": "Juan Pérez",
    "number": "1234567890"
  }
}
```

### 4. Flujo de Mensajes Salientes

```
Cliente REST → API Server → WhatsApp Web → Destinatario
     ↓            ↓            ↓            ↓
Solicitud    Validación    Envío        Confirmación
```

## 🚀 Instalación y Configuración

### Prerrequisitos

- Node.js >= 18.0.0
- NPM o Yarn
- Navegador compatible con Puppeteer

### Instalación

```bash
# Clonar el repositorio
git clone <repository-url>
cd waapi-impulsala

# Instalar dependencias
npm install

# Configurar variables de entorno (opcional)
cp .env.example .env
# Editar .env con tus configuraciones
```

### Variables de Entorno

```env
# Puerto del servidor (opcional, por defecto: 3000)
PORT=3000

# URL del webhook de n8n (opcional)
N8N_WEBHOOK_URL=https://tu-n8n-instance.com/webhook/endpoint
```

### Ejecución

```bash
# Modo desarrollo
npm run dev

# Modo producción
npm start
```

## 📡 API Endpoints

### 1. Información del Servicio

```http
GET /
```

**Respuesta:**

```json
{
  "service": "WhatsApp API",
  "status": "connected",
  "endpoints": {
    "GET /status": "Estado de conexión",
    "GET /qr": "Obtener código QR",
    "POST /send-message": "Enviar mensaje"
  }
}
```

### 2. Estado de Conexión

```http
GET /status
```

**Respuesta:**

```json
{
  "connected": true,
  "phone": "1234567890",
  "hasQR": false,
  "timestamp": "2024-01-01T12:00:00.000Z"
}
```

### 3. Obtener Código QR

```http
GET /qr
```

**Respuesta:**

```json
{
  "qr": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...",
  "status": "waiting"
}
```

### 4. Enviar Mensaje

```http
POST /send-message
Content-Type: application/json

{
  "phone": "1234567890",
  "message": "Hola desde la API"
}
```

**Respuesta:**

```json
{
  "success": true,
  "messageId": "3EB0C767D82B8A6B",
  "to": "1234567890",
  "message": "Hola desde la API",
  "timestamp": "2024-01-01T12:00:00.000Z"
}
```

### 5. Webhook de Prueba

```http
POST /webhook
Content-Type: application/json

{
  "test": "data"
}
```

## 🔧 Configuración de n8n

### Webhook de Entrada

1. Crear un nuevo workflow en n8n
2. Agregar un nodo "Webhook"
3. Configurar el endpoint (ej: `/webhook-test/2c7ead7f-8f29-4727-854b-d2a8f20ff76a`)
4. Copiar la URL del webhook
5. Configurar la variable `N8N_WEBHOOK_URL` en el servidor

### Estructura de Datos Recibidos

```json
{
  "from": "1234567890@c.us",
  "body": "Mensaje del usuario",
  "timestamp": 1234567890,
  "isGroup": false,
  "contact": {
    "name": "Nombre del Contacto",
    "number": "1234567890"
  }
}
```

## 📁 Estructura del Proyecto

```
waapi-impulsala/
├── server.js              # Servidor principal
├── package.json           # Configuración y dependencias
├── package-lock.json      # Lock de dependencias
├── .gitignore            # Archivos ignorados por Git
├── .env                  # Variables de entorno (crear)
├── whatsapp-session/     # Sesiones de WhatsApp (auto-generado)
├── .wwebjs_auth/         # Autenticación de WhatsApp (auto-generado)
├── .wwebjs_cache/        # Cache de WhatsApp (auto-generado)
└── node_modules/         # Dependencias (auto-generado)
```

## 🔒 Seguridad

### Archivos Sensibles

- `whatsapp-session/`: Contiene datos de sesión de WhatsApp
- `.wwebjs_auth/`: Credenciales de autenticación
- `.env`: Variables de entorno sensibles

### Recomendaciones

1. **Nunca** subir archivos de sesión a Git
2. Usar variables de entorno para configuraciones sensibles
3. Implementar autenticación en endpoints si es necesario
4. Usar HTTPS en producción

## 🐛 Solución de Problemas

### Error de Conexión

```bash
# Verificar que el puerto esté disponible
netstat -an | grep :3000

# Reiniciar el servidor
npm start
```

### QR No Se Genera

```bash
# Limpiar cache y sesiones
rm -rf .wwebjs_auth/
rm -rf .wwebjs_cache/
rm -rf whatsapp-session/

# Reiniciar el servidor
npm start
```

### Mensajes No Se Envían

1. Verificar que WhatsApp esté conectado (`GET /status`)
2. Verificar formato del número de teléfono
3. Revisar logs del servidor

### Webhook No Funciona

1. Verificar URL del webhook en n8n
2. Verificar conectividad de red
3. Revisar logs del servidor

## 📊 Monitoreo

### Logs del Servidor

```bash
# Ver logs en tiempo real
tail -f logs/app.log

# Ver logs de errores
grep "ERROR" logs/app.log
```

### Métricas de Salud

- Estado de conexión: `GET /status`
- Disponibilidad: `GET /`
- Webhook: `POST /webhook`

## 🔄 Actualizaciones

### Actualizar Dependencias

```bash
npm update
npm audit fix
```

### Actualizar WhatsApp Web.js

```bash
npm install whatsapp-web.js@latest
```

## 📞 Soporte

Para reportar problemas o solicitar nuevas funcionalidades:

1. Crear un issue en el repositorio
2. Incluir logs relevantes
3. Describir pasos para reproducir el problema
4. Especificar versión de Node.js y sistema operativo

## 📄 Licencia

Este proyecto está bajo la licencia MIT. Ver archivo LICENSE para más detalles.

---

**Desarrollado por Impulsala** 🚀
