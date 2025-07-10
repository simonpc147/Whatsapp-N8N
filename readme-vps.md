IP: 168.231.68.54
Contraseña: 4+mjv7nK5#BJ?mEln,Cc

ssh root@168.231.68.54

Actualizar tu VPS:

# Detener la aplicación actual

pm2 stop whatsapp-api

# Actualizar el código

cd ~/whatsapp-api/Whatsapp-N8N
git pull origin main

# Reinstalar dependencias (por si acaso)

npm install

# Reiniciar

pm2 restart whatsapp-api

# Ver logs

pm2 logs whatsapp-api
