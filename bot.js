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
    ip: process.env.VMIX_IP || 'ed5e4cc3e9e9.ngrok-free.app',
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

Camera Keys configured:
- Camera 1: 8b615bc7-97ab-4f4f-99b2-add6701bd482
- Camera 2: 635faf79-fcfb-4354-b2b1-6dce2e1448db
- Camera 3: d449b257-9907-4621-b933-90553b1dc9bf
- Camera 4: 20d4f6e4-709e-4590-a7cc-6d894f6340ee

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

// Clase VmixAPI con keys específicas de cámaras
class VmixAPI {
  constructor(ip, port) {
    this.ip = ed5e4cc3e9e9.ngrok-free.app;
    this.port = port;
    // Configurar según el tipo de IP
    if (ip.includes('ngrok')) {
      this.baseUrl = `https://${ip}`;
    } else {
      this.baseUrl = `http://${ip}:${port}`;
    }
    
    // KEYS de las cámaras (obtenidas del HTML de vMix)
    this.cameraKeys = {
      1: '8b615bc7-97ab-4f4f-99b2-add6701bd482',  // camara 1
      2: '635faf79-fcfb-4354-b2b1-6dce2e1448db',  // camara 2
      3: 'd449b257-9907-4621-b933-90553b1dc9bf',  // Sample Input 1
      4: '20d4f6e4-709e-4590-a7cc-6d894f6340ee'   // Sample Input 2
    };
    
    console.log(`🔑 Keys de cámaras configuradas: ${Object.keys(this.cameraKeys).length} cámaras`);
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

  // Función para obtener el estado de UNA cámara específica
  async getCameraState(cameraNumber) {
    try {
      const key = this.cameraKeys[cameraNumber];
      if (!key) {
        throw new Error(`No hay key configurada para cámara ${cameraNumber}`);
      }
      
      // USAR /tallyupdate/ en lugar de /tally/
      const response = await fetch(`${this.baseUrl}/tallyupdate/?key=${key}`, { 
        timeout: 5000,
        headers: {
          'ngrok-skip-browser-warning': 'true'
        }
      });
      
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      
      const responseText = await response.text();
      console.log(`📱 Respuesta raw cámara ${cameraNumber}:`, JSON.stringify(responseText.substring(0, 100)));
      
      // El endpoint /tallyupdate/ devuelve JavaScript: tallyChange("#FF0000") para rojo
      // tallyChange("#FFFF00") para amarillo, tallyChange("#000000") para off
      
      let state = 0; // Default OFF
      
      if (responseText.includes('#FF0000') || responseText.includes('#ff0000')) {
        state = 1; // PROGRAM (rojo)
      } else if (responseText.includes('#FFFF00') || responseText.includes('#ffff00')) {
        state = 2; // PREVIEW (amarillo)
      } else if (responseText.includes('#000000')) {
        state = 0; // OFF (negro)
      }
      
      console.log(`📹 Cámara ${cameraNumber}: ${state} (${state === 1 ? 'PROGRAM' : state === 2 ? 'PREVIEW' : 'OFF'})`);
      
      return state;
    } catch (error) {
      console.error(`❌ Error detallado cámara ${cameraNumber}:`, error);
      throw new Error(`Error obteniendo estado de cámara ${cameraNumber}: ${error.message}`);
    }
  }

  // Función para obtener el estado de todas las cámaras
  async getTallyData() {
    try {
      const program = [];
      const preview = [];
      
      // Consultar solo las cámaras configuradas (1, 2, 3, 4)
      for (const [cameraNumber, key] of Object.entries(this.cameraKeys)) {
        const state = await this.getCameraState(parseInt(cameraNumber));
        
        if (state === 1) {
          program.push(parseInt(cameraNumber));
        } else if (state === 2) {
          preview.push(parseInt(cameraNumber));
        }
      }
      
      console.log(`✅ RESULTADO FINAL: Program=[${program.join(',')}] Preview=[${preview.join(',')}]`);
      
      return {
        program: program,
        preview: preview,
        timestamp: Date.now()
      };
      
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
/camara [número] - Asignar tu cámara (ej: /camara 1)
/estado - Ver estado actual de tu cámara
/todas - Ver estado de todas las cámaras
/salir - Dejar de recibir notificaciones
/ayuda - Mostrar esta ayuda

**Cámaras disponibles:**
- Cámara 1: camara 1
- Cámara 2: camara 2  
- Cámara 3: Sample Input 1
- Cámara 4: Sample Input 2

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
    return ctx.reply('❌ Por favor especifica el número de cámara.\nEjemplo: /camara 1\n\nCámaras disponibles: 1, 2, 3, 4');
  }
  
  const cameraNumber = parseInt(args[1]);
  
  if (isNaN(cameraNumber) || cameraNumber < 1 || cameraNumber > 4) {
    return ctx.reply('❌ Número de cámara inválido.\nCámaras disponibles: 1, 2, 3, 4');
  }
  
  try {
    const existingUser = await db.getUserByCamera(cameraNumber);
    if (existingUser && existingUser.user_id !== userId) {
      return ctx.reply(`❌ La cámara ${cameraNumber} ya está asignada a otro operador.`);
    }
    
    await db.assignCamera(userId, username, cameraNumber);
    
    // Obtener el nombre de la cámara
    const cameraNames = {
      1: 'camara 1',
      2: 'camara 2',
      3: 'Sample Input 1',
      4: 'Sample Input 2'
    };
    
    ctx.reply(`✅ Cámara ${cameraNumber} (${cameraNames[cameraNumber]}) asignada correctamente.\n🔔 Recibirás notificaciones cuando esté en aire.`);
    
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
      return ctx.reply('❌ No tienes una cámara asignada.\nUsa /camara [número] para asignar una.\n\nCámaras disponibles: 1, 2, 3, 4');
    }
    
    const state = await vmix.getCameraState(user.camera_number);
    
    let status = '⚫ OFF';
    if (state === 1) status = '🔴 ON AIR';
    else if (state === 2) status = '🟡 PREVIEW';
    
    const cameraNames = {
      1: 'camara 1',
      2: 'camara 2',
      3: 'Sample Input 1',
      4: 'Sample Input 2'
    };
    
    ctx.reply(`📹 **Cámara ${user.camera_number}** (${cameraNames[user.camera_number]})\n${status}`);
  } catch (error) {
    console.error('Error obteniendo estado:', error);
    ctx.reply('❌ Error al consultar el estado. Verifica la conexión con vMix.');
  }
});

bot.command('todas', async (ctx) => {
  try {
    const tally = await vmix.getTallyData();
    let message = '📊 **Estado de todas las cámaras:**\n\n';
    
    const cameraNames = {
      1: 'camara 1',
      2: 'camara 2',
      3: 'Sample Input 1',
      4: 'Sample Input 2'
    };
    
    for (let i = 1; i <= 4; i++) {
      const isOnAir = tally.program.includes(i);
      const isPreview = tally.preview.includes(i);
      
      let status = '⚫';
      if (isOnAir) status = '🔴';
      else if (isPreview) status = '🟡';
      
      message += `Cámara ${i} (${cameraNames[i]}): ${status}\n`;
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
/camara [número] - Asignar tu cámara (1-4)
/estado - Ver estado de tu cámara
/todas - Ver todas las cámaras
/salir - Dejar de recibir notificaciones

**Cámaras disponibles:**
- Cámara 1: camara 1
- Cámara 2: camara 2
- Cámara 3: Sample Input 1
- Cámara 4: Sample Input 2

**Ejemplos:**
\`/camara 1\` - Te asigna la cámara 1
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
        console.log(`🎯 Estado inicial obtenido correctamente`);
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
