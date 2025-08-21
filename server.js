const path = require('path');
const fs = require('fs');

// Datos en memoria (no persistente)
// Cargar datos desde data.json si existe
let datos;
const DATA_FILE = path.join(__dirname, 'data.json');
function cargarDatos() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    datos = JSON.parse(raw);
  } catch {
    datos = { usuarios: [], premios: [], admin: { usuario: 'REBL', password: 'Corp' } };
  }
}
function guardarDatos() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(datos, null, 2), 'utf8');
  } catch (err) {
    console.error('Error guardando datos:', err);
  }
}
cargarDatos();

const express = require('express');
const webpush = require('web-push');
const WebSocket = require('ws');
const app = express();
const http = require('http');
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Middleware para procesar JSON antes de cualquier endpoint
app.use(express.json());

// Servir archivos estáticos (index.html, sw.js)
// Redirige cualquier acceso a /data.json hacia index.html
app.get('/data.json', (req, res) => {
  res.redirect('/index.html');
});
app.use(express.static(path.join(__dirname)));

// --- Endpoints para menú dinámico ---
const MENU_FILE = path.join(__dirname, 'menu_data.json');

// Leer menú (GET)
app.get('/menu_data', (req, res) => {
  fs.readFile(MENU_FILE, 'utf8', (err, data) => {
    if (err) {
      // Si no existe, crear archivo vacío y devolverlo
      const emptyMenu = { categorias: [], productos: [] };
      fs.writeFileSync(MENU_FILE, JSON.stringify(emptyMenu, null, 2), 'utf8');
      return res.json(emptyMenu);
    }
    try {
      res.json(JSON.parse(data));
    } catch {
      res.status(500).json({ error: 'Menú corrupto.' });
    }
  });
});

// Guardar menú (POST)
app.post('/menu_data', (req, res) => {
  const { categorias, productos } = req.body || {};
  if (!Array.isArray(categorias) || !Array.isArray(productos)) {
    return res.status(400).json({ error: 'Formato inválido.' });
  }
  // Validar productos: nombre, categoria, precio
  for (const prod of productos) {
    if (!prod.nombre || !prod.categoria || typeof prod.precio !== 'number') {
      return res.status(400).json({ error: 'Producto inválido.' });
    }
  }
  const nuevoMenu = { categorias, productos };
  fs.writeFile(MENU_FILE, JSON.stringify(nuevoMenu, null, 2), 'utf8', err => {
    if (err) return res.status(500).json({ error: 'No se pudo guardar el menú.' });
    res.json({ success: true });
  });
});

// --- Configuración de web-push ---
// Generar claves VAPID automáticamente si no existen
const KEYS_FILE = path.join(__dirname, 'webpush-keys.js');
if (!fs.existsSync(KEYS_FILE)) {
  require('./generate-vapid');
}
const vapidKeys = require('./webpush-keys');
webpush.setVapidDetails(
  'mailto:tu-email@ejemplo.com',
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

// Almacenar suscripciones push
// Usar datos.usuarios en vez de clientes

app.get('/vapidPublicKey', (req, res) => {
  res.send(vapidKeys.publicKey);
});

app.post('/subscribe', (req, res) => {
  const { nombre, telefono, subscription } = req.body;
  console.log('Datos recibidos en /subscribe:', req.body);
  if (!nombre || !telefono) {
    console.error('Error: Faltan nombre o teléfono');
    return res.status(400).json({ error: 'Faltan nombre o teléfono' });
  }
  if (!subscription) {
    console.error('Error: Falta el objeto subscription');
    return res.status(400).json({ error: 'Falta el objeto subscription' });
  }
  if (!subscription.endpoint) {
    console.error('Error: Falta el endpoint en subscription');
    return res.status(400).json({ error: 'Falta el endpoint en subscription' });
  }
  // Evitar duplicados por endpoint o teléfono
  let usuario = datos.usuarios.find(u => (u.subscription && u.subscription.endpoint === subscription.endpoint) || u.telefono === telefono);
  let nuevo = false;
  if (usuario) {
    usuario.nombre = nombre;
    usuario.telefono = telefono;
    usuario.subscription = subscription;
    if (typeof usuario.sellos !== 'number') usuario.sellos = 0;
  } else {
    const id = Date.now().toString();
    datos.usuarios.push({ id, nombre, telefono, subscription, sellos: 0 });
    nuevo = true;
  }
  guardarDatos();
  res.status(201).json({ message: 'Suscripción guardada' });
  // Notifica a todos los clientes conectados por WebSocket
  setTimeout(() => {
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ tipo: 'actualizar-clientes' }));
      }
    });
  }, 100);
});

// Listar clientes
app.get('/clientes', (req, res) => {
  // Solo usuarios con suscripción válida
  res.json(datos.usuarios.filter(u => u.subscription && u.subscription.endpoint).map(u => ({
    id: u.id,
    nombre: u.nombre,
    telefono: u.telefono,
    sellos: u.sellos || 0,
    premio: u.premio || null
  })));
});

// Endpoint para agregar sellos a un usuario
app.post('/agregarSello', (req, res) => {
  const { id } = req.body;
  const usuario = datos.usuarios.find(u => u.id === id);
  if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (typeof usuario.sellos !== 'number') usuario.sellos = 0;
  if (usuario.sellos >= 10) {
    return res.status(400).json({ error: 'Ya tiene el máximo de sellos' });
  }
  usuario.sellos++;
  // Si el usuario llega a 10 sellos y no tiene premio asignado, asigna uno al azar
  if (usuario.sellos >= 10 && !usuario.premio) {
    const premiosDisponibles = (datos.premios || []).filter(p => !p.canjeado);
    if (premiosDisponibles.length > 0) {
      const premioAzar = premiosDisponibles[Math.floor(Math.random() * premiosDisponibles.length)];
      usuario.premio = premioAzar.id;
    }
  }
  guardarDatos();
  res.json({ message: 'Sello agregado', sellos: usuario.sellos, premio: usuario.premio });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ tipo: 'actualizar-clientes' }));
    }
  });
});

// --- Endpoints de premios ---
// Listar premios
app.get('/premios', (req, res) => {
  res.json(datos.premios || []);
});

// Crear premio
app.post('/premios', (req, res) => {
  const { nombre } = req.body;
  if (!nombre) return res.status(400).json({ error: 'Falta el nombre del premio' });
  const id = Date.now().toString();
  if (!datos.premios) datos.premios = [];
  datos.premios.push({ id, nombre, canjeado: false });
  guardarDatos();
  res.status(201).json({ message: 'Premio creado', id });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ tipo: 'actualizar-premios' }));
    }
  });
});

// Eliminar premio por id
app.delete('/premios/:id', (req, res) => {
  const id = req.params.id;
  const idx = datos.premios.findIndex(p => p.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Premio no encontrado' });
  datos.premios.splice(idx, 1);
  guardarDatos();
  res.json({ message: 'Premio eliminado' });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ tipo: 'actualizar-premios' }));
    }
  });
});

// Marcar tarjeta como canjeada (limpiar sellos y premio)
app.post('/premios/canjear', (req, res) => {
  const { usuarioId } = req.body;
  const usuario = datos.usuarios.find(u => u.id === usuarioId);
  if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });
  usuario.sellos = 0;
  usuario.premio = null;
  guardarDatos();
  res.json({ message: 'Tarjeta reiniciada' });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ tipo: 'actualizar-clientes' }));
    }
  });
});

// --- WebSocket ---
wss.on('connection', ws => {
  ws.send(JSON.stringify({ tipo: 'conexion', mensaje: '¡Conexión WebSocket establecida!' }));
  ws.on('message', message => {
    // Reenviar mensaje a todos los clientes en formato JSON
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ tipo: 'mensaje', mensaje: message }));
      }
    });
  });
});

// Endpoint para registrar usuarios desde el formulario de suscripción
app.post('/api/usuarios', (req, res) => {
  const { nombre } = req.body;
  if (!nombre) return res.status(400).json({ error: 'Falta el nombre' });
  let usuario = datos.usuarios.find(u => u.nombre === nombre);
  if (!usuario) {
    const id = Date.now().toString();
    datos.usuarios.push({ id, nombre, telefono: '' });
    guardarDatos();
    res.status(201).json({ message: 'Usuario registrado' });
  } else {
    res.status(200).json({ message: 'Usuario ya registrado' });
  }
  // Notifica a todos los clientes conectados por WebSocket
  setTimeout(() => {
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ tipo: 'actualizar-clientes' }));
      }
    });
  }, 100);
});

// Eliminar cliente por id
app.delete('/clientes/:id', (req, res) => {
  const id = req.params.id;
  const idx = datos.usuarios.findIndex(u => u.id === id);
  if (idx === -1) return res.status(404).json({ error: 'No encontrado' });
  datos.usuarios.splice(idx, 1);
  guardarDatos();
  res.json({ message: 'Cliente eliminado' });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ tipo: 'actualizar-clientes' }));
    }
  });
});

// Enviar notificación push manualmente
app.post('/sendPush', async (req, res) => {
  const { title, message, ids, icon } = req.body;
  let enviados = 0;
  let usuariosEnviar = [];
  if (ids === 'all') {
    usuariosEnviar = datos.usuarios.filter(u => u.subscription && u.subscription.endpoint);
  } else if (Array.isArray(ids)) {
    usuariosEnviar = datos.usuarios.filter(u => ids.includes(u.id.toString()) && u.subscription && u.subscription.endpoint);
  }
  for (const usuario of usuariosEnviar) {
    let payloadObj = {
      title,
      message: `Hola: ${usuario.nombre}  ${message} `
    };
    if (icon) payloadObj.icon = icon;
    const payload = JSON.stringify(payloadObj);
    try {
      await webpush.sendNotification(usuario.subscription, payload);
      enviados++;
    } catch (err) {
      // Manejar error
    }
  }
  res.json({ message: `Notificaciones enviadas a ${enviados} clientes` });
});

// --- LOGIN Y VALIDACIÓN DE COOKIE ---
const crypto = require('crypto');

function generarToken(usuario) {
  // Crea un token base64 con usuario y fecha
  const payload = JSON.stringify({ usuario, fecha: Date.now() });
  return Buffer.from(payload).toString('base64');
}
function validarToken(token) {
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf8');
    const obj = JSON.parse(decoded);
    // Opcional: puedes validar fecha, usuario, etc.
    return obj && obj.usuario === datos.admin.usuario;
  } catch {
    return false;
  }
}

app.post('/login', (req, res) => {
  const { usuario, password } = req.body;
  if (usuario === datos.admin.usuario && password === datos.admin.password) {
    const token = generarToken(usuario);
    res.json({ success: true, token });
  } else {
    res.json({ success: false });
  }
});

app.post('/validate', (req, res) => {
  const { token } = req.body;
  res.json({ valid: validarToken(token) });
});

server.listen(3000, () => {
  console.log('Servidor escuchando en http://localhost:3000');
  console.log('Clave pública VAPID para el cliente:', vapidKeys.publicKey);
});