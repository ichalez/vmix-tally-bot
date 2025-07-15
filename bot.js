const { Telegraf } = require('telegraf');
const Database = require('./database');
const VmixAPI = require('./vmix-api');

// Configuración desde variables de entorno
const config = {
  telegram: {
    token: process.env.TELEGRAM_TOKEN || 'TU_TOKEN_AQUI'
  },
  vmix: {
    ip: process.env.VMIX_IP || '192.168.1.100',
    port: process.env.VMIX_PORT || '8088',
    pollInterval: parseInt(process.env.POLL_INTERVAL) || 1000
  }
};

// Inicializar bot y servicios
const bot = new Telegraf(config.telegram.token);
const db = new Database();
const vmix = new VmixAPI(config.vmix.ip, config.vmix.port);

// Estado anterior para detectar cambios
let previousTally = {};

// Comando /start
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

// Comando /camara
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
    // Verificar si la cámara ya está asignada
    const existingUser = await db.getUserByCamera(cameraNumber);
    if (existingUser && existingUser.user_id !== userId) {
      return ctx.reply(`❌ La cámara ${cameraNumber} ya está asignada a otro operador.`);
    }
    
    // Asignar cámara al usuario
    await db.assignCamera(userId, username, cameraNumber);
    ctx.reply(`✅ Cámara ${cameraNumber} asignada correctamente.\n🔔 Recibirás notificaciones cuando esté en aire.`);
    
    console.log(`👤 Usuario @${username} asignado a cámara ${cameraNumber}`);
  } catch (error) {
    console.error('Error asignando cámara:', error);
    ctx.reply('❌ Error al asignar la cámara. Inténtalo de nuevo.');
  }
});

// Comando /estado
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

// Comando /todas (solo para debugging)
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

// Comando /salir
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

// Comando /ayuda
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

// Función para notificar cambios de tally
async function notifyTallyChanges(currentTally) {
  try {
    const users = await db.getAllUsers();
    
    for (const user of users) {
      const cameraNum = user.camera_number;
      const wasOnAir = previousTally.program && previousTally.program.includes(cameraNum);
      const isOnAir = currentTally.program.includes(cameraNum);
      
      // Notificar cuando la cámara se activa
      if (!wasOnAir && isOnAir) {
        await bot.telegram.sendMessage(user.user_id, '🔴 **TU CÁMARA ESTÁ EN AIRE**', {
          parse_mode: 'Markdown'
        });
        console.log(`🔴 Notificado: Cámara ${cameraNum} ON AIR → @${user.username}`);
      }
      
      // Notificar cuando la cámara se desactiva
      if (wasOnAir && !isOnAir) {
        await bot.telegram.sendMessage(user.user_id, '⚫ Tu cámara ya no está en aire', {
          parse_mode: 'Markdown'
        });
        console.log(`⚫ Notificado: Cámara ${cameraNum} OFF → @${user.username}`);
      }
    }
  } catch (error) {
    console.error('Error notificando cambios:', error);
  }
}

// Monitoreo continuo de vMix
async function monitorVmix() {
  try {
    const currentTally = await vmix.getTallyData();
    
    // Verificar cambios y notificar
    if (Object.keys(previousTally).length > 0) {
      await notifyTallyChanges(currentTally);
    }
    
    previousTally = currentTally;
  } catch (error) {
    console.error('Error monitoreando vMix:', error.message);
  }
}

// Inicializar aplicación
async function start() {
  try {
    console.log('🚀 Iniciando vMix Tally Bot...');
    
    // Inicializar base de datos
    await db.init();
    console.log('✅ Base de datos inicializada');
    
    // Probar conexión con vMix
    await vmix.testConnection();
    console.log(`✅ Conectado a vMix en ${config.vmix.ip}:${config.vmix.port}`);
    
    // Iniciar bot de Telegram
    await bot.launch();
    console.log('✅ Bot de Telegram iniciado');
    
    // Iniciar monitoreo
    setInterval(monitorVmix, config.vmix.pollInterval);
    console.log(`🔍 Monitoreando tally cada ${config.vmix.pollInterval}ms`);
    
  } catch (error) {
    console.error('❌ Error al iniciar:', error);
    process.exit(1);
  }
}

// Manejo de cierre graceful
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

// Iniciar aplicación
start();
