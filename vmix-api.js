const fetch = require('node-fetch');
const { parseString } = require('xml2js');

class VmixAPI {
  constructor(ip, port) {
    this.ip = ip;
    this.port = port;
    this.baseUrl = `http://${ip}:${port}`;
  }

  // Probar conexión con vMix
  async testConnection() {
    try {
      const response = await fetch(`${this.baseUrl}/api/`, {
        timeout: 5000
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      return true;
    } catch (error) {
      throw new Error(`No se puede conectar a vMix en ${this.ip}:${this.port} - ${error.message}`);
    }
  }

  // Obtener datos XML de vMix
  async getVmixData() {
    try {
      const response = await fetch(`${this.baseUrl}/api/`, {
        timeout: 5000
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const xml = await response.text();
      return xml;
    } catch (error) {
      throw new Error(`Error obteniendo datos de vMix: ${error.message}`);
    }
  }

  // Parsear XML a objeto JavaScript
  async parseXmlData(xml) {
    return new Promise((resolve, reject) => {
      parseString(xml, (err, result) => {
        if (err) {
          reject(new Error(`Error parseando XML: ${err.message}`));
        } else {
          resolve(result);
        }
      });
    });
  }

  // Obtener información de tally (programa y preview)
  async getTallyData() {
    try {
      const xml = await this.getVmixData();
      const data = await this.parseXmlData(xml);
      
      const vmix = data.vmix;
      const program = [];
      const preview = [];
      
      // Obtener input activo en programa
      if (vmix.active && vmix.active[0]) {
        const activeInput = parseInt(vmix.active[0]);
        if (!isNaN(activeInput)) {
          program.push(activeInput);
        }
      }
      
      // Obtener input en preview
      if (vmix.preview && vmix.preview[0]) {
        const previewInput = parseInt(vmix.preview[0]);
        if (!isNaN(previewInput)) {
          preview.push(previewInput);
        }
      }
      
      // Buscar overlays activos (pueden estar en programa también)
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
      
      return {
        program: program,
        preview: preview,
        timestamp: Date.now()
      };
      
    } catch (error) {
      throw new Error(`Error obteniendo tally: ${error.message}`);
    }
  }

  // Obtener información de todos los inputs
  async getInputsInfo() {
    try {
      const xml = await this.getVmixData();
      const data = await this.parseXmlData(xml);
      
      const inputs = [];
      
      if (data.vmix && data.vmix.inputs && data.vmix.inputs[0] && data.vmix.inputs[0].input) {
        data.vmix.inputs[0].input.forEach((input, index) => {
          inputs.push({
            number: index + 1,
            key: input.$.key,
            type: input.$.type,
            title: input.$.title,
            state: input.$.state || 'Paused',
            duration: input.$.duration || '0'
          });
        });
      }
      
      return inputs;
    } catch (error) {
      throw new Error(`Error obteniendo inputs: ${error.message}`);
    }
  }

  // Obtener estadísticas básicas
  async getStats() {
    try {
      const xml = await this.getVmixData();
      const data = await this.parseXmlData(xml);
      
      if (!data.vmix) {
        throw new Error('Respuesta XML inválida');
      }
      
      const vmix = data.vmix;
      
      return {
        version: vmix.version ? vmix.version[0] : 'Desconocida',
        edition: vmix.edition ? vmix.edition[0] : 'Desconocida',
        recording: vmix.recording ? vmix.recording[0] : 'False',
        streaming: vmix.streaming ? vmix.streaming[0] : 'False',
        playList: vmix.playList ? vmix.playList[0] : 'False',
        multiCorder: vmix.multiCorder ? vmix.multiCorder[0] : 'False',
        fullscreen: vmix.fullscreen ? vmix.fullscreen[0] : 'False'
      };
    } catch (error) {
      throw new Error(`Error obteniendo estadísticas: ${error.message}`);
    }
  }
}

module.exports = VmixAPI;