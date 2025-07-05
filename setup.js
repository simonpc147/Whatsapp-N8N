const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const express = require("express");
const fetch = require("node-fetch");
require("dotenv").config();

const app = express();
app.use(express.json());

let client;
let isReady = false;
let qrString = "";

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
        "--disable-web-security",
        "--disable-features=VizDisplayCompositor",
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
    qrString = "";
  });

  client.on("auth_failure", () => {
    console.error("❌ Error de autenticación");
    isReady = false;
  });

  client.on("disconnected", (reason) => {
    console.log("⚠️ WhatsApp desconectado:", reason);
    isReady = false;
    qrString = "";
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

      const webhookUrl = process.env.N8N_WEBHOOK_URL;
      if (webhookUrl) {
        await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(messageData),
        });
        console.log("✅ Mensaje enviado a n8n");
      }
    } catch (error) {
      console.error("❌ Error enviando a n8n:", error.message);
    }
  });

  client.initialize();
}

// Endpoint para mostrar QR en el navegador
app.get("/qr", (req, res) => {
  if (qrString) {
    res.send(`
      <html>
        <head><title>WhatsApp QR</title></head>
        <body style="text-align: center; font-family: Arial;">
          <h2>Escanea con WhatsApp</h2>
          <div id="qrcode"></div>
          <p>Ve a WhatsApp > Configuración > Dispositivos vinculados</p>
          <script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js"></script>
          <script>
            QRCode.toCanvas(document.getElementById('qrcode'), '${qrString}', function (error) {
              if (error) console.error(error);
            });
          </script>
        </body>
      </html>
    `);
  } else if (isReady) {
    res.send("<h2>✅ WhatsApp ya está conectado</h2>");
  } else {
    res.send(
      "<h2>⏳ Generando QR...</h2><script>setTimeout(() => location.reload(), 3000);</script>"
    );
  }
});

app.post("/send-message", async (req, res) => {
  try {
    if (!isReady) {
      return res.status(400).json({
        error: "WhatsApp no está conectado. Visita /qr para conectar.",
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
  });
});

app.get("/", (req, res) => {
  res.json({
    service: "WhatsApp API",
    status: isReady ? "connected" : "disconnected",
    endpoints: {
      "GET /": "Esta información",
      "GET /status": "Estado de conexión",
      "GET /qr": "Mostrar QR para conectar",
      "POST /send-message": "Enviar mensaje (body: {phone, message})",
    },
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Servidor iniciado en puerto ${PORT}`);
  console.log(`📡 API disponible en: http://localhost:${PORT}`);
  console.log(`🔲 QR disponible en: http://localhost:${PORT}/qr`);
  console.log("\n⏳ Iniciando WhatsApp...\n");

  initWhatsApp();
});
