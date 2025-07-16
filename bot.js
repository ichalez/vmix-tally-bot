const { Telegraf } = require('telegraf');
const fetch = require('node-fetch');
const { parseString } = require('xml2js');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Configuración
const config = {
  telegram: {
    token: process.env.TELEGRAM_TOKEN || '7809887342:AAELfj3I8VNBDoI2oZ9KZuh8RfK-plJ9sOM'
  },
  vmix: {
    ip: process.env.VMIX_IP || '192.168.1.100',
    port: process.env.VMIX_PORT || '8088',
    pollInterval: parseInt(process.env.POLL_INTERVAL) || 1000
  }
};

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
    this.baseUrl = `http://${ip}:${port}`;
  }

  async testConnection() {
    try {
      const response = await fetch(`${this.baseUrl}/api/`, { timeout: 5000 });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return true;
    } catch (error) {
      throw new Error(`No se puede conectar a vMix en ${this.ip}:${this.port} - ${error.message}`);
    }
  }

  async getTallyData() {
    try {
      const response = await fetch(`${this.baseUrl}/api/`, { timeout: 5000 });
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

// Monitoreo de cambios
async function notifyTallyChanges(currentTally) {
  try {
    const users = await db.getAllUsers();
    
    for (const user of users) {
      const cameraNum = user.camera_number;
      const wasOnAir = previousTally.program && previousTally.program.includes(cameraNum);
      const isOnAir = currentTally.program.includes(cameraNum);
      
      if (!wasOnAir && isOnAir) {
        await bot.telegram.sendMessage(user.user_id, '🔴 **TU CÁMARA ESTÁ EN AIRE**', {
          parse_mode: 'Markdown'
        });
        console.log(`🔴 Notificado: Cámara ${cameraNum} ON AIR → @${user.username}`);
      }
      
      if (wasOnAir && !isOnAir) {
        await bot.telegram.sendMessage(user.user_id, '⚫ Tu cámara ya no está en aire');
        console.log(`⚫ Notificado: Cámara ${cameraNum} OFF → @${user.username}`);
      }
    }
  } catch (error) {
    console.error('Error notificando cambios:', error);
  }
}

async function monitorVmix() {
  try {
    const currentTally = await vmix.getTallyData();
    
    if (Object.keys(previousTally).length > 0) {
      await notifyTallyChanges(currentTally);
    }
    
    previousTally = currentTally;
  } catch (error) {
    console.error('Error monitoreando vMix:', error.message);
  }
}

// Iniciar aplicación
async function start() {
  try {
    console.log('🚀 Iniciando vMix Tally Bot...');
    
    await db.init();
    console.log('✅ Base de datos inicializada');
    
    await vmix.testConnection();
    console.log(`✅ Conectado a vMix en ${config.vmix.ip}:${config.vmix.port}`);
    
    await bot.launch();
    console.log('✅ Bot de Telegram iniciado');
    
    setInterval(monitorVmix, config.vmix.pollInterval);
    console.log(`🔍 Monitoreando tally cada ${config.vmix.pollInterval}ms`);
    
  } catch (error) {
    console.error('❌ Error al iniciar:', error);
    process.exit(1);
  }
}

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

start();
