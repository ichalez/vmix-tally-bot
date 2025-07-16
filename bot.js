
const { Telegraf } = require('telegraf');
const fetch = require('node-fetch');
const { parseString } = require('xml2js');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const http = require('http');

// Configuración
const config = {
  telegram: {
    token: process.env.TELEGRAM_TOKEN || '7809887342:AAELfj3I8VNBDoI2oZ9KZuh8RfK-plJ9sOM'
  },
  vmix: {
    ip: process.env.VMIX_IP || 'f6973a92a9af.ngrok-free.app',
    port: process.env.VMIX_PORT || '8088',
    pollInterval: parseInt(process.env.POLL_INTERVAL) || 1000
  }
};

const PORT = process.env.PORT || 3000;

// Crear servidor HTTP simple para mantener Railway activo
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end(`vMix Tally Bot is running!

Bot status: Active
Monitoring vMix at: ${config.vmix.ip}
Poll interval: ${config.vmix.pollInterval}ms
Telegram token: ${config.telegram.token ? 'Configured' : 'Missing'}

Bot commands:
/start - Start the bot
/camara [number] - Assign camera
/estado - Check camera status
/todas - Show all cameras
/salir - Stop notifications
/ayuda - Show help
`);
});

// Iniciar servidor
server.listen(PORT, () => {
  console.log(`🌐 Servidor HTTP ejecutándose en puerto ${PORT}`);
});

// Clase Database simple
class Database {
  constructor() {
    this.dbPath = path.join(__dirname, 'tally.db');
    this.db = null;
  }

  async init() {
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) reject(err);
        else this.createTables().then(resolve).catch(reject);
      });
    });
  }

  async createTables() {
    return new Promise((resolve, reject) => {
      const createUsersTable = `
        CREATE TABLE IF NOT EXISTS users (
          user_id INTEGER PRIMARY KEY,
          username TEXT,
          camera_number INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `;

      this.db.run(createUsersTable, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async assignCamera(userId, username, cameraNumber) {
    return new Promise((resolve, reject) => {
      const query = `INSERT OR REPLACE INTO users (user_id, username, camera_number) VALUES (?, ?, ?)`;
      this.db.run(query, [userId, username, cameraNumber], function(err) {
        if (err) reject(err);
        else resolve(this.lastID);
      });
    });
  }

  async getUserById(userId) {
    return new Promise((resolve, reject) => {
      const query = 'SELECT * FROM users WHERE user_id = ?';
      this.db.get(query, [userId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  async getUserByCamera(cameraNumber) {
    return new Promise((resolve, reject) => {
      const query = 'SELECT * FROM users WHERE camera_number = ?';
      this.db.get(query, [cameraNumber], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  async getAllUsers() {
    return new Promise((resolve, reject) => {
      const query = 'SELECT * FROM users ORDER BY camera_number';
      this.db.all(query, [], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

  async removeUser(userId) {
    return new Promise((resolve, reject) => {
      const query = 'DELETE FROM users WHERE user_id = ?';
      this.db.run(query, [userId], function(err) {
        if (err) reject(err);
        else resolve(this.changes);
      });
    });
  }
}

// Clase VmixAPI simple
class VmixAPI {
  constructor(ip, port) {
    this.ip = ip;
    this.port = port;
    // Para ngrok usamos HTTPS sin puerto
    this.baseUrl = `https://${ip}`;
  }

  async testConnection() {
    try {
      console.log(`🔗 Probando conexión a ${this.baseUrl}/api/`);
      const response = await fetch(`${this.baseUrl}/api/`, { 
        timeout: 5000,
        headers: {
          'ngrok-skip-browser-warning': 'true'
        }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      console.log('✅ Conexión exitosa');
      return true;
    } catch (error) {
      console.error(`❌ Error de conexión: ${error.message}`);
      throw new Error(`No se puede conectar a vMix en ${this.ip} - ${error.message}`);
    }
  }

  async getTallyData() {
    try {
      const response = await fetch(`${this.baseUrl}/api/`, { 
        timeout: 5000,
        headers: {
          'ngrok-skip-browser-warning': 'true'
        }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const xml = await response.text();
      
      return new Promise((resolve, reject) => {
        parseString(xml, (err, result) => {
          if (err) {
            reject(new Error(`Error parseando XML: ${err.message}`));
            return;
          }
          
          const vmix = result.vmix;
          const program = [];
          const preview = [];
          
          // Obtener input activo en programa
          if (vmix.active && vmix.active[0]) {
            const activeInput = parseInt(vmix.active[0]);
            if (!isNaN(activeInput)) program.push(activeInput);
          }
          
          // Obtener input en preview
          if (vmix.preview && vmix.preview[0]) {
            const previewInput = parseInt(vmix.preview[0]);
            if (!isNaN(previewInput)) preview.push(previewInput);
          }
          
          // Buscar overlays activos
          if (vmix.overlays && vmix.overlays[0] && vmix.overlays[0].overlay) {
            vmix.overlays[0].overlay.forEach(overlay => {
              if (overlay.$ && overlay.$.number) {
                const overlayInput = parseInt(overlay.$.number);
                if (!isNaN(overlayInput) && !program.includes(overlayInput)) {
                  program.push(overlayInput);
                }
              }
            });
          }
          
          resolve({
            program: program,
            preview: preview,
            timestamp: Date.now()
          });
        });
      });
    } catch (error) {
      throw new Error(`Error obteniendo tally: ${error.message}`);
    }
  }
}

// Inicializar
const bot = new Telegraf(config.telegram.token);
const db = new Database();
const vmix = new VmixAPI(config.vmix.ip, config.vmix.port);

let previousTally = {};

// Comandos del bot
bot.start((ctx) => {
  const welcomeMessage = `
🎥 **vMix Tally Bot**

¡Hola! Soy tu asistente para notificaciones de tally.

**Comandos disponibles:**
/camara [número] - Asignar tu cámara (ej: /camara 3)
/estado - Ver estado actual de tu cámara
/todas - Ver estado de todas las cámaras
/salir - Dejar de recibir notificaciones
/ayuda - Mostrar esta ayuda

**Para empezar:**
Usa /camara seguido del número de tu cámara.
Ejemplo: \`/camara 1\`
  `;
  ctx.replyWithMarkdown(welcomeMessage);
});

bot.command('camara', async (ctx) => {
  const userId = ctx.from.id;
  const username = ctx.from.username || ctx.from.first_name;
  const args = ctx.message.text.split(' ');
  
  if (args.length < 2) {
    return ctx.reply('❌ Por favor especifica el número de cámara.\nEjemplo: /camara 3');
  }
  
  const cameraNumber = parseInt(args[1]);
  
  if (isNaN(cameraNumber) || cameraNumber < 1 || cameraNumber > 20) {
    return ctx.reply('❌ Número de cámara inválido. Usa un número entre 1 y 20.');
  }
  
  try {
    const existingUser = await db.getUserByCamera(cameraNumber);
    if (existingUser && existingUser.user_id !== userId) {
      return ctx.reply(`❌ La cámara ${cameraNumber} ya está asignada a otro operador.`);
    }
    
    await db.assignCamera(userId, username, cameraNumber);
    ctx.reply(`✅ Cámara ${cameraNumber} asignada correctamente.\n🔔 Recibirás notificaciones cuando esté en aire.`);
    
    console.log(`👤 Usuario @${username} asignado a cámara ${cameraNumber}`);
  } catch (error) {
    console.error('Error asignando cámara:', error);
    ctx.reply('❌ Error al asignar la cámara. Inténtalo de nuevo.');
  }
});

bot.command('estado', async (ctx) => {
  const userId = ctx.from.id;
  
  try {
    const user = await db.getUserById(userId);
    if (!user) {
      return ctx.reply('❌ No tienes una cámara asignada.\nUsa /camara [número] para asignar una.');
    }
    
    const tally = await vmix.getTallyData();
    const isOnAir = tally.program.includes(user.camera_number);
    const isPreview = tally.preview.includes(user.camera_number);
    
    let status = '⚫ OFF';
    if (isOnAir) status = '🔴 ON AIR';
    else if (isPreview) status = '🟡 PREVIEW';
    
    ctx.reply(`📹 **Cámara ${user.camera_number}**\n${status}`);
  } catch (error) {
    console.error('Error obteniendo estado:', error);
    ctx.reply('❌ Error al consultar el estado. Verifica la conexión con vMix.');
  }
});

bot.command('todas', async (ctx) => {
  try {
    const tally = await vmix.getTallyData();
    let message = '📊 **Estado de todas las cámaras:**\n\n';
    
    for (let i = 1; i <= 8; i++) {
      const isOnAir = tally.program.includes(i);
      const isPreview = tally.preview.includes(i);
      
      let status = '⚫';
      if (isOnAir) status = '🔴';
      else if (isPreview) status = '🟡';
      
      message += `Cámara ${i}: ${status}\n`;
    }
    
    ctx.replyWithMarkdown(message);
  } catch (error) {
    console.error('Error obteniendo todas las cámaras:', error);
    ctx.reply('❌ Error al consultar vMix.');
  }
});

bot.command('salir', async (ctx) => {
  const userId = ctx.from.id;
  
  try {
    await db.removeUser(userId);
    ctx.reply('✅ Te has desuscrito de las notificaciones.');
  } catch (error) {
    console.error('Error removiendo usuario:', error);
    ctx.reply('❌ Error al desuscribirse.');
  }
});

bot.command('ayuda', (ctx) => {
  const helpMessage = `
🎥 **vMix Tally Bot - Ayuda**

**Comandos:**
/camara [número] - Asignar tu cámara
/estado - Ver estado de tu cámara
/todas - Ver todas las cámaras
/salir - Dejar de recibir notificaciones

**Ejemplos:**
\`/camara 3\` - Te asigna la cámara 3
\`/estado\` - Ve si tu cámara está en aire

**Estados:**
🔴 ON AIR - Cámara en programa
🟡 PREVIEW - Cámara en preview
⚫ OFF - Cámara inactiva

**Soporte:**
Si hay problemas, contacta al administrador.
  `;
  ctx.replyWithMarkdown(helpMessage);
});

// Monitoreo de cambios con logs detallados
async function notifyTallyChanges(currentTally) {
  try {
    const users = await db.getAllUsers();
    console.log(`👥 Usuarios registrados: ${users.length}`);
    
    for (const user of users) {
      const cameraNum = user.camera_number;
      const wasOnAir = previousTally.program && previousTally.program.includes(cameraNum);
      const isOnAir = currentTally.program.includes(cameraNum);
      
      console.log(`🎥 Cámara ${cameraNum} (@${user.username}): wasOnAir=${wasOnAir}, isOnAir=${isOnAir}`);
      
      // Notificar cuando la cámara se activa
      if (!wasOnAir && isOnAir) {
        console.log(`🔴 ENVIANDO NOTIFICACIÓN: Cámara ${cameraNum} ON AIR → @${user.username}`);
        try {
          await bot.telegram.sendMessage(user.user_id, '🔴 **TU CÁMARA ESTÁ EN AIRE**', {
            parse_mode: 'Markdown'
          });
          console.log(`✅ Notificación enviada a usuario ${user.user_id}`);
        } catch (error) {
          console.error(`❌ Error enviando notificación a ${user.user_id}:`, error);
        }
      }
      
      // Notificar cuando la cámara se desactiva
      if (wasOnAir && !isOnAir) {
        console.log(`⚫ ENVIANDO NOTIFICACIÓN: Cámara ${cameraNum} OFF → @${user.username}`);
        try {
          await bot.telegram.sendMessage(user.user_id, '⚫ Tu cámara ya no está en aire');
          console.log(`✅ Notificación OFF enviada a usuario ${user.user_id}`);
        } catch (error) {
          console.error(`❌ Error enviando notificación OFF a ${user.user_id}:`, error);
        }
      }
    }
  } catch (error) {
    console.error('❌ Error notificando cambios:', error);
  }
}

// Función de monitoreo con logs detallados
async function monitorVmix() {
  console.log('🔄 Ejecutando monitorVmix...');
  try {
    const currentTally = await vmix.getTallyData();
    
    // Log detallado para debugging
    console.log(`📊 Tally check: Program=[${currentTally.program.join(',')}] Preview=[${currentTally.preview.join(',')}]`);
    
    // Verificar cambios y notificar
    if (Object.keys(previousTally).length > 0) {
      console.log('🔄 Verificando cambios...');
      await notifyTallyChanges(currentTally);
    } else {
      console.log('⏳ Esperando estado inicial...');
    }
    
    previousTally = currentTally;
  } catch (error) {
    console.error('❌ Error monitoreando vMix:', error.message);
  }
}

// Función de prueba para verificar que el monitoreo funciona
async function testMonitoring() {
  console.log('🧪 PRUEBA: Ejecutando monitoreo manual...');
  try {
    const tally = await vmix.getTallyData();
    console.log(`🧪 PRUEBA: Tally obtenido: Program=[${tally.program.join(',')}] Preview=[${tally.preview.join(',')}]`);
  } catch (error) {
    console.log(`🧪 PRUEBA ERROR: ${error.message}`);
  }
}

// Iniciar aplicación
async function start() {
  try {
    console.log('🚀 Iniciando vMix Tally Bot...');
    
    // Inicializar base de datos
    await db.init();
    console.log('✅ Base de datos inicializada');
    
    // Probar conexión con vMix
    await vmix.testConnection();
    console.log(`✅ Conectado a vMix en ${config.vmix.ip}`);
    
    // Iniciar bot de Telegram
    await bot.launch();
    console.log('✅ Bot de Telegram iniciado');
    
    // IMPORTANTE: Iniciar monitoreo continuo
    console.log('🔄 Iniciando monitoreo...');
    const monitorInterval = setInterval(monitorVmix, config.vmix.pollInterval);
    console.log(`🔍 Monitoreando tally cada ${config.vmix.pollInterval}ms`);
    
    // Verificar que el intervalo se creó
    if (monitorInterval) {
      console.log('✅ Intervalo de monitoreo creado exitosamente');
    } else {
      console.log('❌ ERROR: No se pudo crear el intervalo de monitoreo');
    }
    
    // Obtener estado inicial después de 5 segundos
    setTimeout(async () => {
      try {
        console.log('🎯 Obteniendo estado inicial...');
        const initialTally = await vmix.getTallyData();
        previousTally = initialTally;
        console.log(`🎯 Estado inicial: Program=[${initialTally.program.join(',')}] Preview=[${initialTally.preview.join(',')}]`);
      } catch (error) {
        console.error('❌ Error obteniendo estado inicial:', error);
      }
    }, 5000);
    
    // Prueba manual de monitoreo después de 10 segundos
    setTimeout(() => {
      console.log('🧪 Ejecutando prueba manual de monitoreo...');
      testMonitoring();
    }, 10000);
    
  } catch (error) {
    console.error('❌ Error al iniciar:', error);
    console.error('❌ Stack trace:', error.stack);
    process.exit(1);
  }
}

// Manejo de cierre graceful
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

// Iniciar aplicación
start();
