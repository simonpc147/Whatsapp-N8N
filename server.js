const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const express = require("express");
const fetch = require("node-fetch");
const http = require("http");
const socketIo = require("socket.io");
const fs = require("fs");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// Middleware
app.use(express.static("public"));
app.use(express.json());

let client;
let isReady = false;
let qrString = null;
let connectedSockets = new Set();
let sessionPath = "./whatsapp-session"; // Variable para el path de sesión

const N8N_WEBHOOK_URL =
  process.env.N8N_WEBHOOK_URL ||
  "https://n8n.srv895959.hstgr.cloud/webhook-test/2c7ead7f-8f29-4727-854b-d2a8f20ff76a";

// ========================================
// FUNCIONES DE LIMPIEZA DE SESIÓN
// ========================================

function deleteSessionFolder() {
  return new Promise((resolve) => {
    if (!fs.existsSync(sessionPath)) {
      console.log("🧹 No hay carpeta de sesión para eliminar");
      resolve();
      return;
    }

    console.log("🧹 Eliminando carpeta de sesión:", sessionPath);

    // Función recursiva para eliminar directorio con reintentos
    const deleteWithRetry = (dirPath, retries = 5) => {
      setTimeout(() => {
        try {
          if (fs.existsSync(dirPath)) {
            // Cambiar permisos antes de eliminar (Windows)
            if (process.platform === "win32") {
              try {
                require("child_process").execSync(
                  `attrib -R "${dirPath}\\*.*" /S`,
                  { stdio: "ignore" }
                );
              } catch (e) {
                // Ignorar error de attrib
              }
            }

            fs.rmSync(dirPath, { recursive: true, force: true });
            console.log("✅ Carpeta de sesión eliminada exitosamente");
          }
          resolve();
        } catch (error) {
          console.log(
            `⚠️ Error eliminando sesión (intento ${6 - retries}/5):`,
            error.message
          );

          if (retries > 0) {
            deleteWithRetry(dirPath, retries - 1);
          } else {
            console.log(
              "❌ No se pudo eliminar la carpeta de sesión después de 5 intentos"
            );
            console.log(
              "💡 Puede que necesites eliminarla manualmente:",
              dirPath
            );
            resolve();
          }
        }
      }, 1000); // Esperar 1 segundo antes de intentar
    };

    deleteWithRetry(sessionPath);
  });
}

function generateNewSessionPath() {
  sessionPath = `./whatsapp-session-${Date.now()}`;
  console.log("📁 Nueva ruta de sesión:", sessionPath);
  return sessionPath;
}

// ========================================
// HTTP ENDPOINTS (REST API)
// ========================================

// Endpoint para enviar mensaje vía HTTP
app.post("/api/send-message", async (req, res) => {
  console.log(`\n📤 HTTP REQUEST - Envío de mensaje:`);
  console.log("   Data:", JSON.stringify(req.body, null, 2));

  try {
    if (!isReady) {
      console.log("   ❌ WhatsApp no conectado");
      return res.status(400).json({
        success: false,
        error: "WhatsApp no está conectado",
        status: qrString ? "waiting_qr" : "initializing",
      });
    }

    const { phone, message } = req.body;

    if (!phone || !message) {
      console.log("   ❌ Parámetros faltantes");
      return res.status(400).json({
        success: false,
        error: "Faltan parámetros: phone y message son requeridos",
      });
    }

    const chatId = phone.includes("@") ? phone : `${phone}@c.us`;
    console.log("   📞 Chat ID:", chatId);
    console.log("   💬 Mensaje:", message);

    console.log("   🚀 Enviando mensaje...");
    const startTime = Date.now();
    const result = await client.sendMessage(chatId, message);
    const endTime = Date.now();

    console.log(`   ✅ Mensaje enviado en ${endTime - startTime}ms`);
    console.log("   📊 Result ID:", result.id._serialized);

    const responseData = {
      success: true,
      messageId: result.id._serialized,
      to: phone,
      message: message,
      timestamp: new Date().toISOString(),
      sendTime: endTime - startTime,
    };

    // Notificar a clientes Socket.IO
    broadcastToClients("message_sent_api", responseData);

    res.json(responseData);
  } catch (error) {
    console.error("   ❌ ERROR enviando mensaje:");
    console.error("      Tipo:", error.name);
    console.error("      Mensaje:", error.message);

    res.status(500).json({
      success: false,
      error: "Error enviando mensaje",
      details: error.message,
    });
  }

  console.log("📤 FIN HTTP REQUEST\n");
});

// Endpoint para obtener estado vía HTTP
app.get("/api/status", (req, res) => {
  const statusData = {
    connected: isReady,
    phone: isReady ? client?.info?.wid?.user : null,
    hasQR: !!qrString,
    timestamp: new Date().toISOString(),
    connectedClients: connectedSockets.size,
  };

  res.json(statusData);
});

// Endpoint para obtener QR vía HTTP
app.get("/api/qr", (req, res) => {
  console.log(`📱 HTTP REQUEST - Código QR`);

  if (qrString) {
    res.json({ qr: qrString, status: "waiting" });
  } else if (isReady) {
    res.json({ qr: null, status: "connected" });
  } else {
    res.json({ qr: null, status: "initializing" });
  }
});

// Endpoint para reiniciar WhatsApp vía HTTP
app.post("/api/restart", async (req, res) => {
  console.log(`🔄 HTTP REQUEST - Reinicio de WhatsApp`);

  if (client) {
    try {
      await client.destroy();
    } catch (error) {
      console.log("⚠️ Error destruyendo cliente:", error.message);
    }
  }

  // Limpiar sesión antes de reiniciar
  await deleteSessionFolder();

  setTimeout(() => {
    initWhatsApp();
  }, 3000); // Esperar 3 segundos después de limpiar

  res.json({
    success: true,
    message: "Reinicio iniciado con limpieza de sesión",
    timestamp: new Date().toISOString(),
  });
});

// Agregar endpoint para limpiar sesión manualmente
app.post("/api/clean-session", async (req, res) => {
  console.log(`🧹 HTTP REQUEST - Limpieza manual de sesión`);

  try {
    if (client) {
      await client.destroy();
      isReady = false;
      qrString = null;
    }

    await deleteSessionFolder();

    res.json({
      success: true,
      message: "Sesión limpiada exitosamente",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Error limpiando sesión",
      details: error.message,
    });
  }
});

// Endpoint para obtener información de contacto vía HTTP
app.get("/api/contact/:phone", async (req, res) => {
  console.log(`👤 HTTP REQUEST - Información de contacto: ${req.params.phone}`);

  try {
    if (!isReady) {
      return res.status(400).json({
        success: false,
        error: "WhatsApp no está conectado",
      });
    }

    const phone = req.params.phone;
    const chatId = phone.includes("@") ? phone : `${phone}@c.us`;

    const contact = await client.getContactById(chatId);

    res.json({
      success: true,
      contact: {
        name: contact.name || contact.pushname,
        number: contact.number,
        isMyContact: contact.isMyContact,
        profilePicUrl: contact.profilePicUrl,
      },
    });
  } catch (error) {
    console.error("   ❌ ERROR obteniendo contacto:", error.message);
    res.status(500).json({
      success: false,
      error: "Error obteniendo información del contacto",
      details: error.message,
    });
  }
});

// Endpoint para que n8n envíe respuestas automáticas
app.post("/api/send-auto-response", async (req, res) => {
  console.log(`\n📤 AUTO RESPONSE - Respuesta automática desde n8n:`);
  console.log("   Data:", JSON.stringify(req.body, null, 2));

  try {
    if (!isReady) {
      console.log("   ❌ WhatsApp no conectado");
      return res.status(400).json({
        success: false,
        error: "WhatsApp no está conectado",
      });
    }

    const { phone, parte_1, parte_2, parte_3 } = req.body;

    if (!phone) {
      console.log("   ❌ Falta el número de teléfono");
      return res.status(400).json({
        success: false,
        error: "El parámetro 'phone' es requerido",
      });
    }

    const chatId = phone.includes("@") ? phone : `${phone}@c.us`;
    console.log("   📞 Chat ID:", chatId);

    const responses = [];

    // Enviar parte 1
    if (parte_1) {
      console.log("   📩 Enviando parte 1...");
      const result1 = await client.sendMessage(chatId, parte_1);
      responses.push({ part: 1, messageId: result1.id._serialized });
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    // Enviar parte 2
    if (parte_2) {
      console.log("   📩 Enviando parte 2...");
      const result2 = await client.sendMessage(chatId, parte_2);
      responses.push({ part: 2, messageId: result2.id._serialized });
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    // Enviar parte 3
    if (parte_3) {
      console.log("   📩 Enviando parte 3...");
      const result3 = await client.sendMessage(chatId, parte_3);
      responses.push({ part: 3, messageId: result3.id._serialized });
    }

    console.log("   ✅ Todas las respuestas automáticas enviadas");

    const responseData = {
      success: true,
      to: phone,
      responses: responses,
      timestamp: new Date().toISOString(),
    };

    // Notificar a clientes Socket.IO
    broadcastToClients("auto_response_sent", responseData);

    res.json(responseData);
  } catch (error) {
    console.error("   ❌ ERROR enviando respuesta automática:");
    console.error("      Mensaje:", error.message);

    res.status(500).json({
      success: false,
      error: "Error enviando respuesta automática",
      details: error.message,
    });
  }

  console.log("📤 FIN AUTO RESPONSE\n");
});

// Endpoint para obtener lista de chats vía HTTP
app.get("/api/chats", async (req, res) => {
  console.log(`💬 HTTP REQUEST - Lista de chats`);

  try {
    if (!isReady) {
      return res.status(400).json({
        success: false,
        error: "WhatsApp no está conectado",
      });
    }

    const chats = await client.getChats();
    const chatList = chats.slice(0, 20).map((chat) => ({
      id: chat.id._serialized,
      name: chat.name,
      isGroup: chat.isGroup,
      timestamp: chat.timestamp,
      unreadCount: chat.unreadCount,
    }));

    res.json({
      success: true,
      chats: chatList,
      total: chats.length,
    });
  } catch (error) {
    console.error("   ❌ ERROR obteniendo chats:", error.message);
    res.status(500).json({
      success: false,
      error: "Error obteniendo lista de chats",
      details: error.message,
    });
  }
});

// ========================================
// SOCKET.IO EVENTS (TIEMPO REAL)
// ========================================

io.on("connection", (socket) => {
  console.log(`🔌 Cliente Socket.IO conectado: ${socket.id}`);
  connectedSockets.add(socket);

  // Enviar estado actual al cliente
  socket.emit("status", {
    connected: isReady,
    hasQR: !!qrString,
    qr: qrString,
    phone: isReady ? client?.info?.wid?.user : null,
    timestamp: new Date().toISOString(),
  });

  // Manejar solicitud de QR
  socket.on("get_qr", () => {
    console.log(`📱 Socket.IO - Cliente ${socket.id} solicita QR`);
    if (qrString) {
      socket.emit("qr_code", { qr: qrString, status: "waiting" });
    } else if (isReady) {
      socket.emit("qr_code", { qr: null, status: "connected" });
    } else {
      socket.emit("qr_code", { qr: null, status: "initializing" });
    }
  });

  // Manejar envío de mensajes vía Socket.IO
  socket.on("send_message", async (data) => {
    console.log(`\n📤 SOCKET.IO - Envío desde ${socket.id}:`);
    console.log("   Data:", JSON.stringify(data, null, 2));

    try {
      if (!isReady) {
        console.log("   ❌ WhatsApp no conectado");
        socket.emit("send_message_error", {
          error: "WhatsApp no está conectado",
          status: qrString ? "waiting_qr" : "initializing",
          requestId: data.requestId,
        });
        return;
      }

      const { phone, message, requestId } = data;

      if (!phone || !message) {
        console.log("   ❌ Parámetros faltantes");
        socket.emit("send_message_error", {
          error: "Faltan parámetros: phone y message son requeridos",
          requestId,
        });
        return;
      }

      const chatId = phone.includes("@") ? phone : `${phone}@c.us`;
      console.log("   📞 Chat ID:", chatId);
      console.log("   💬 Mensaje:", message);

      console.log("   🚀 Enviando mensaje...");
      const startTime = Date.now();
      const result = await client.sendMessage(chatId, message);
      const endTime = Date.now();

      console.log(`   ✅ Mensaje enviado en ${endTime - startTime}ms`);
      console.log("   📊 Result ID:", result.id._serialized);

      const responseData = {
        success: true,
        messageId: result.id._serialized,
        to: phone,
        message: message,
        timestamp: new Date().toISOString(),
        sendTime: endTime - startTime,
        requestId,
      };

      socket.emit("send_message_success", responseData);
      broadcastToClients("message_sent_socket", responseData);
    } catch (error) {
      console.error("   ❌ ERROR enviando mensaje:");
      console.error("      Tipo:", error.name);
      console.error("      Mensaje:", error.message);

      socket.emit("send_message_error", {
        error: "Error enviando mensaje",
        details: error.message,
        requestId: data.requestId,
      });
    }

    console.log("📤 FIN Socket.IO request\n");
  });

  // Manejar solicitud de estado vía Socket.IO
  socket.on("get_status", () => {
    console.log(`📊 Socket.IO - Cliente ${socket.id} solicita estado`);
    socket.emit("status_response", {
      connected: isReady,
      phone: isReady ? client?.info?.wid?.user : null,
      hasQR: !!qrString,
      timestamp: new Date().toISOString(),
      connectedClients: connectedSockets.size,
    });
  });

  // Manejar reinicio de WhatsApp vía Socket.IO
  socket.on("restart_whatsapp", async () => {
    console.log(`🔄 Socket.IO - Cliente ${socket.id} solicita reinicio`);

    if (client) {
      try {
        await client.destroy();
      } catch (error) {
        console.log("⚠️ Error destruyendo cliente:", error.message);
      }
    }

    // Limpiar sesión antes de reiniciar
    await deleteSessionFolder();

    setTimeout(() => {
      initWhatsApp();
    }, 3000);

    socket.emit("restart_initiated", {
      timestamp: new Date().toISOString(),
      sessionCleaned: true,
    });
  });

  socket.on("disconnect", () => {
    console.log(`🔌 Cliente Socket.IO desconectado: ${socket.id}`);
    connectedSockets.delete(socket);
  });
});

// ========================================
// WHATSAPP CLIENT FUNCTIONS
// ========================================

function broadcastToClients(event, data) {
  console.log(`📡 Broadcasting ${event} a ${connectedSockets.size} clientes`);
  io.emit(event, data);
}

function initWhatsApp() {
  console.log("🚀 Iniciando cliente de WhatsApp...");

  // Generar nueva ruta de sesión para evitar conflictos
  generateNewSessionPath();

  client = new Client({
    authStrategy: new LocalAuth({
      dataPath: sessionPath,
    }),
    puppeteer: {
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--no-zygote",
        "--disable-gpu",
        "--disable-extensions",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
      ],
    },
  });

  client.on("qr", (qr) => {
    qrString = qr;
    console.log("\n🔲 QR generado - disponible en /api/qr");
    console.log("📱 Ve a: WhatsApp > Configuración > Dispositivos vinculados");
    console.log("⏰ El QR expira en 20 segundos...\n");
    qrcode.generate(qr, { small: true });

    broadcastToClients("qr", { qr: qrString, status: "waiting" });
  });

  client.on("ready", () => {
    console.log("✅ ¡WhatsApp conectado exitosamente!");
    console.log("📞 Número conectado:", client.info.wid.user);
    console.log("📊 Info del cliente:", JSON.stringify(client.info, null, 2));
    isReady = true;
    qrString = null;

    broadcastToClients("ready", {
      connected: true,
      phone: client.info.wid.user,
      timestamp: new Date().toISOString(),
    });
  });

  client.on("auth_failure", async (msg) => {
    console.error("❌ Error de autenticación:", msg);
    qrString = null;
    isReady = false;

    // Limpiar sesión después de fallo de autenticación
    console.log("🧹 Limpiando sesión después de fallo de autenticación...");
    await deleteSessionFolder();

    broadcastToClients("auth_failure", {
      error: msg,
      sessionCleaned: true,
    });
  });

  client.on("disconnected", async (reason) => {
    console.log("⚠️ WhatsApp desconectado. Razón:", reason);
    isReady = false;
    qrString = null;

    broadcastToClients("disconnected", { reason });

    // Limpiar sesión automáticamente al desconectarse
    console.log("🧹 Iniciando limpieza automática de sesión...");
    try {
      if (client) {
        await client.destroy();
      }
    } catch (error) {
      console.log("⚠️ Error destruyendo cliente:", error.message);
    }

    setTimeout(async () => {
      await deleteSessionFolder();
      console.log("✅ Sesión limpiada automáticamente");

      setTimeout(() => {
        initWhatsApp();
        console.log("🚀 Cliente reiniciado - nuevo QR será generado");
      }, 3000);
    }, 2000);
  });

  client.on("message", async (message) => {
    console.log("\n📨 MENSAJE RECIBIDO - Análisis completo:");
    console.log("   From:", message.from);
    console.log("   Body:", `"${message.body}"`); // Comillas para ver contenido vacío
    console.log("   Body Length:", message.body ? message.body.length : 0);
    console.log("   Type:", message.type);
    console.log("   IsGroup:", message.isGroup);
    console.log("   HasMedia:", message.hasMedia);
    console.log("   IsStatus:", message.isStatus);
    console.log("   FromMe:", message.fromMe);
    console.log(
      "   Timestamp:",
      new Date(message.timestamp * 1000).toISOString()
    );

    if (
      message.from === "status@broadcast" ||
      message.isStatus ||
      message.fromMe ||
      message.isGroup ||
      message.from.includes("@g.us") ||
      !message.body ||
      message.body.trim() === ""
    ) {
      return;
    }

    try {
      console.log("   🔍 Obteniendo información del contacto...");
      const contact = await message.getContact();
      console.log("   👤 Contacto obtenido:", {
        name: contact.name,
        pushname: contact.pushname,
        number: contact.number,
        isMyContact: contact.isMyContact,
      });

      const messageData = {
        from: message.from,
        body: message.body,
        timestamp: message.timestamp,
        isGroup: message.isGroup,
        type: message.type,
        contact: {
          name: contact.name || contact.pushname,
          number: contact.number,
          isMyContact: contact.isMyContact,
        },
        receivedAt: new Date().toISOString(),
      };

      console.log(
        "   📤 Enviando a n8n:",
        JSON.stringify(messageData, null, 2)
      );

      const startTime = Date.now();
      const response = await fetch(N8N_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(messageData),
      });

      const endTime = Date.now();
      console.log(
        `   ✅ Respuesta de n8n recibida en ${endTime - startTime}ms`
      );
      console.log(`   📊 Status: ${response.status} ${response.statusText}`);

      if (response.ok) {
        // Procesar respuesta de n8n y enviar de vuelta al usuario
        try {
          const n8nResponse = await response.json();
          console.log(
            "   📤 Respuesta de n8n:",
            JSON.stringify(n8nResponse, null, 2)
          );

          // Enviar las partes de respuesta
          const userChatId = message.from;

          if (n8nResponse.parte_1) {
            console.log("   📩 Enviando parte 1...");
            await client.sendMessage(userChatId, n8nResponse.parte_1);
            await new Promise((resolve) => setTimeout(resolve, 1000)); // Pausa 1 segundo
          }

          if (n8nResponse.parte_2) {
            console.log("   📩 Enviando parte 2...");
            await client.sendMessage(userChatId, n8nResponse.parte_2);
            await new Promise((resolve) => setTimeout(resolve, 1000)); // Pausa 1 segundo
          }

          if (n8nResponse.parte_3) {
            console.log("   📩 Enviando parte 3...");
            await client.sendMessage(userChatId, n8nResponse.parte_3);
          }

          console.log("   ✅ Todas las respuestas enviadas exitosamente");
        } catch (parseError) {
          console.error(
            "   ❌ Error procesando respuesta de n8n:",
            parseError.message
          );
        }
      } else {
        const errorText = await response.text();
        console.log(`   ❌ Error en respuesta: ${errorText}`);
      }

      // Broadcast del mensaje a clientes Socket.IO conectados
      broadcastToClients("message_received", messageData);
    } catch (error) {
      console.error("   ❌ ERROR procesando mensaje:");
      console.error("      Tipo:", error.name);
      console.error("      Mensaje:", error.message);
      console.error("      Stack:", error.stack);

      broadcastToClients("message_error", {
        error: error.message,
        from: message.from,
        timestamp: new Date().toISOString(),
      });
    }

    console.log("📨 FIN del procesamiento del mensaje\n");
  });

  client.on("message_create", (message) => {
    // Solo mensajes enviados por nosotros
    if (message.fromMe) {
      console.log("\n📤 MENSAJE ENVIADO:");
      console.log("   To:", message.to);
      console.log("   Body:", message.body);
      console.log("   Type:", message.type);
      console.log(
        "   Timestamp:",
        new Date(message.timestamp * 1000).toISOString()
      );

      broadcastToClients("message_sent", {
        to: message.to,
        body: message.body,
        type: message.type,
        timestamp: message.timestamp,
        sentAt: new Date().toISOString(),
      });
    }
  });

  console.log("🔄 Inicializando cliente...");
  client.initialize();
}

// ========================================
// SERVER STARTUP
// ========================================

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Servidor Híbrido iniciado en puerto ${PORT}`);
  console.log(`🌐 HTTP API disponible en: http://localhost:${PORT}/api`);
  console.log(`🔌 Socket.IO disponible en: ws://localhost:${PORT}`);

  console.log("\n📋 ENDPOINTS HTTP disponibles:");
  console.log("   POST /api/send-message - Enviar mensaje");
  console.log(
    "   POST /api/send-auto-response - Enviar respuesta automática (para n8n)"
  );
  console.log("   GET  /api/status - Obtener estado");
  console.log("   GET  /api/qr - Obtener código QR");
  console.log("   POST /api/restart - Reiniciar WhatsApp");
  console.log("   POST /api/clean-session - Limpiar sesión manualmente");
  console.log("   GET  /api/contact/:phone - Información de contacto");
  console.log("   GET  /api/chats - Lista de chats");

  console.log("\n📋 EVENTOS Socket.IO disponibles:");
  console.log("   📤 send_message - Enviar mensaje");
  console.log("   📱 get_qr - Obtener código QR");
  console.log("   📊 get_status - Obtener estado");
  console.log("   🔄 restart_whatsapp - Reiniciar WhatsApp");

  console.log("\n📡 Eventos que emite el servidor:");
  console.log("   📨 message_received - Mensaje recibido");
  console.log("   📤 message_sent - Mensaje enviado");
  console.log("   🔲 qr - Código QR generado");
  console.log("   ✅ send_message_success - Mensaje enviado exitosamente");
  console.log("   ❌ send_message_error - Error enviando mensaje");
  console.log("   📊 status_response - Respuesta de estado");

  console.log(`\n🔗 N8N Webhook: ${N8N_WEBHOOK_URL}`);
  console.log(`👥 Clientes conectados: ${connectedSockets.size}`);
  console.log("\n⏳ Iniciando WhatsApp...\n");

  initWhatsApp();
});
