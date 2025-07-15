const sqlite3 = require('sqlite3').verbose();
const path = require('path');

class Database {
  constructor() {
    this.dbPath = path.join(__dirname, 'tally.db');
    this.db = null;
  }

  // Inicializar base de datos
  async init() {
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          reject(err);
        } else {
          this.createTables()
            .then(() => resolve())
            .catch(reject);
        }
      });
    });
  }

  // Crear tablas necesarias
  async createTables() {
    return new Promise((resolve, reject) => {
      const createUsersTable = `
        CREATE TABLE IF NOT EXISTS users (
          user_id INTEGER PRIMARY KEY,
          username TEXT,
          camera_number INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `;

      const createLogsTable = `
        CREATE TABLE IF NOT EXISTS logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER,
          camera_number INTEGER,
          action TEXT,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users (user_id)
        )
      `;

      this.db.serialize(() => {
        this.db.run(createUsersTable, (err) => {
          if (err) {
            reject(err);
            return;
          }
        });

        this.db.run(createLogsTable, (err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        });
      });
    });
  }

  // Asignar cámara a usuario
  async assignCamera(userId, username, cameraNumber) {
    return new Promise((resolve, reject) => {
      const query = `
        INSERT OR REPLACE INTO users (user_id, username, camera_number, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      `;

      this.db.run(query, [userId, username, cameraNumber], function(err) {
        if (err) {
          reject(err);
        } else {
          // Registrar en logs
          const logQuery = `
            INSERT INTO logs (user_id, camera_number, action)
            VALUES (?, ?, 'assign')
          `;
          
          this.db.run(logQuery, [userId, cameraNumber], (logErr) => {
            if (logErr) {
              console.error('Error registrando log:', logErr);
            }
          });
          
          resolve(this.lastID);
        }
      });
    });
  }

  // Obtener usuario por ID
  async getUserById(userId) {
    return new Promise((resolve, reject) => {
      const query = 'SELECT * FROM users WHERE user_id = ?';
      
      this.db.get(query, [userId], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  // Obtener usuario por número de cámara
  async getUserByCamera(cameraNumber) {
    return new Promise((resolve, reject) => {
      const query = 'SELECT * FROM users WHERE camera_number = ?';
      
      this.db.get(query, [cameraNumber], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  // Obtener todos los usuarios
  async getAllUsers() {
    return new Promise((resolve, reject) => {
      const query = 'SELECT * FROM users ORDER BY camera_number';
      
      this.db.all(query, [], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows || []);
        }
      });
    });
  }

  // Remover usuario
  async removeUser(userId) {
    return new Promise((resolve, reject) => {
      // Primero obtener la cámara para el log
      this.getUserById(userId)
        .then(user => {
          if (user) {
            const logQuery = `
              INSERT INTO logs (user_id, camera_number, action)
              VALUES (?, ?, 'remove')
            `;
            
            this.db.run(logQuery, [userId, user.camera_number], (logErr) => {
              if (logErr) {
                console.error('Error registrando log:', logErr);
              }
            });
          }
        })
        .catch(console.error);

      const query = 'DELETE FROM users WHERE user_id = ?';
      
      this.db.run(query, [userId], function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.changes);
        }
      });
    });
  }

  // Obtener estadísticas
  async getStats() {
    return new Promise((resolve, reject) => {
      const queries = {
        totalUsers: 'SELECT COUNT(*) as count FROM users',
        totalLogs: 'SELECT COUNT(*) as count FROM logs',
        recentActivity: `
          SELECT l.*, u.username 
          FROM logs l 
          LEFT JOIN users u ON l.user_id = u.user_id 
          ORDER BY l.timestamp DESC 
          LIMIT 10
        `
      };

      const results = {};
      let completed = 0;
      const total = Object.keys(queries).length;

      for (const [key, query] of Object.entries(queries)) {
        if (key === 'recentActivity') {
          this.db.all(query, [], (err, rows) => {
            if (err) {
              reject(err);
              return;
            }
            results[key] = rows;
            completed++;
            if (completed === total) {
              resolve(results);
            }
          });
        } else {
          this.db.get(query, [], (err, row) => {
            if (err) {
              reject(err);
              return;
            }
            results[key] = row.count;
            completed++;
            if (completed === total) {
              resolve(results);
            }
          });
        }
      }
    });
  }

  // Limpiar logs antiguos (opcional)
  async cleanOldLogs(daysOld = 30) {
    return new Promise((resolve, reject) => {
      const query = `
        DELETE FROM logs 
        WHERE timestamp < datetime('now', '-${daysOld} days')
      `;
      
      this.db.run(query, [], function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.changes);
        }
      });
    });
  }

  // Cerrar conexión
  async close() {
    return new Promise((resolve, reject) => {
      if (this.db) {
        this.db.close((err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      } else {
        resolve();
      }
    });
  }
}

module.exports = Database;