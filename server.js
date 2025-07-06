const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const express = require("express");
const fetch = require("node-fetch");

const app = express();
app.use(express.json());
app.use(express.static('public'));

let client;
let isReady = false;
let qrString = null;

const N8N_WEBHOOK_URL =
  process.env.N8N_WEBHOOK_URL ||
  "https://n8n.srv895959.hstgr.cloud/webhook-test/2c7ead7f-8f29-4727-854b-d2a8f20ff76a";

function initWhatsApp() {
  client = new Client({
    authStrategy: new LocalAuth({
      dataPath: "./whatsapp-session",
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
    console.log("\n🔲 QR generado - disponible en /qr");
    qrcode.generate(qr, { small: true });
    console.log("📱 Ve a: WhatsApp > Configuración > Dispositivos vinculados");
    console.log("⏰ El QR expira en 20 segundos...\n");
  });

  client.on("ready", () => {
    console.log("✅ ¡WhatsApp conectado exitosamente!");
    console.log("📞 Número conectado:", client.info.wid.user);
    isReady = true;
    qrString = null;
  });

  client.on("auth_failure", () => {
    console.error("❌ Error de autenticación");
    qrString = null;
  });

  client.on("disconnected", () => {
    console.log("⚠️ WhatsApp desconectado");
    isReady = false;
    qrString = null;
  });

  client.on("message", async (message) => {
    if (message.from === "status@broadcast") return;

    console.log(`📨 Mensaje recibido de ${message.from}: ${message.body}`);

    try {
      const contact = await message.getContact();
      const messageData = {
        from: message.from,
        body: message.body,
        timestamp: message.timestamp,
        isGroup: message.isGroup,
        contact: {
          name: contact.name || contact.pushname,
          number: contact.number,
        },
      };

      await fetch(N8N_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(messageData),
      });
      console.log("✅ Mensaje enviado a n8n");
    } catch (error) {
      console.error("❌ Error enviando a n8n:", error.message);
    }
  });

  client.initialize();
}

// Endpoint para obtener QR (útil para interfaces web)
app.get("/qr", (req, res) => {
  if (qrString) {
    res.json({ qr: qrString, status: "waiting" });
  } else if (isReady) {
    res.json({ qr: null, status: "connected" });
  } else {
    res.json({ qr: null, status: "initializing" });
  }
});

app.post("/send-message", async (req, res) => {
  try {
    if (!isReady) {
      return res.status(400).json({
        error: "WhatsApp no está conectado",
        status: qrString ? "waiting_qr" : "initializing",
      });
    }

    const { phone, message } = req.body;

    if (!phone || !message) {
      return res.status(400).json({
        error: "Faltan parámetros: phone y message son requeridos",
      });
    }

    const chatId = phone.includes("@") ? phone : `${phone}@c.us`;
    const result = await client.sendMessage(chatId, message);

    console.log(`✅ Mensaje enviado a ${phone}: ${message}`);

    res.json({
      success: true,
      messageId: result.id._serialized,
      to: phone,
      message: message,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("❌ Error enviando mensaje:", error);
    res.status(500).json({
      error: "Error enviando mensaje",
      details: error.message,
    });
  }
});

app.get("/status", (req, res) => {
  res.json({
    connected: isReady,
    phone: isReady ? client.info?.wid?.user : null,
    hasQR: !!qrString,
    timestamp: new Date().toISOString(),
  });
});

app.get("/api", (req, res) => {
  res.json({
    service: "WhatsApp API",
    status: isReady ? "connected" : "disconnected",
    endpoints: {
      "GET /status": "Estado de conexión",
      "GET /qr": "Obtener código QR",
      "POST /send-message": "Enviar mensaje",
    },
  });
});

app.post("/webhook", (req, res) => {
  console.log("📨 Webhook recibido:", req.body);
  res.json({ received: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Servidor iniciado en puerto ${PORT}`);
  console.log(`📡 API disponible en: http://localhost:${PORT}`);
  console.log("\n📋 Endpoints:");
  console.log("   GET  / - Información del servicio");
  console.log("   GET  /status - Estado de conexión");
  console.log("   GET  /qr - Obtener código QR");
  console.log("   POST /send-message - Enviar mensaje");
  console.log(`\n🔗 N8N Webhook: ${N8N_WEBHOOK_URL}`);
  console.log("\n⏳ Iniciando WhatsApp...\n");

  initWhatsApp();
});
