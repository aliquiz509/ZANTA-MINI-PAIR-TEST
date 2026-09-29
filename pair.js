const express = require("express");
const fs = require("fs");
const mongoose = require("mongoose");
const pino = require("pino");
const { makeid } = require("./gen-id");

const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser,
    DisconnectReason
} = require("@whiskeysockets/baileys");

const router = express.Router();

/* =========================================================
   CONFIG
========================================================= */

const SESSION_DIR = "./sessions";
const RECONNECT_DELAY = 5000;

if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
}

/* =========================================================
   LOGGER
========================================================= */

const logger = pino({
    level: "fatal"
}).child({
    level: "fatal"
});

/* =========================================================
   SESSION SCHEMA
========================================================= */

const SessionSchema = new mongoose.Schema({
    number: {
        type: String,
        unique: true,
        index: true
    },

    creds: {
        type: Object,
        required: true
    },

    added_at: {
        type: Date,
        default: Date.now
    },

    updated_at: {
        type: Date,
        default: Date.now
    }
});

const Session =
    mongoose.models.Session ||
    mongoose.model("Session", SessionSchema);

/* =========================================================
   SAFE FILE REMOVE
========================================================= */

function removeFile(filePath) {
    try {
        if (fs.existsSync(filePath)) {
            fs.rmSync(filePath, {
                recursive: true,
                force: true
            });
        }
    } catch (err) {
        console.log("❌ Session remove error:", err.message);
    }
}

/* =========================================================
   RUNTIME
========================================================= */

const botStartTime = Date.now();

function getRuntime() {

    const seconds = Math.floor(
        (Date.now() - botStartTime) / 1000
    );

    const days = Math.floor(seconds / 86400);

    const hours = Math.floor(
        (seconds % 86400) / 3600
    );

    const minutes = Math.floor(
        (seconds % 3600) / 60
    );

    const secs = seconds % 60;

    return `${days}d ${hours}h ${minutes}m ${secs}s`;
}

/* =========================================================
   PAIR ROUTE
========================================================= */

router.get("/", async (req, res) => {

    const id = makeid();

    let num = req.query.number;

    if (!num) {
        return res.json({
            code: "❌ Number Missing"
        });
    }

    /* Clean phone number */
    num = String(num).replace(/[^0-9]/g, "");

    if (num.length < 8) {
        return res.json({
            code: "❌ Invalid Number"
        });
    }

    const sessionPath = `${SESSION_DIR}/session-${id}`;

    let reconnecting = false;
    let socket = null;

    /* =====================================================
       START SOCKET
    ===================================================== */

    async function startPair() {

        try {

            const {
                state,
                saveCreds
            } = await useMultiFileAuthState(sessionPath);

            socket = makeWASocket({

                auth: {
                    creds: state.creds,

                    keys: makeCacheableSignalKeyStore(
                        state.keys,
                        logger
                    )
                },

                printQRInTerminal: false,

                logger,

                browser: Browsers.ubuntu("Chrome"),

                markOnlineOnConnect: false,

                generateHighQualityLinkPreview: false,

                syncFullHistory: false
            });

            /* =================================================
               SAVE CREDENTIALS
            ================================================= */

            socket.ev.on(
                "creds.update",
                async () => {

                    try {
                        await saveCreds();
                    } catch (err) {
                        console.log(
                            "❌ Credentials save error:",
                            err.message
                        );
                    }

                }
            );

            /* =================================================
               PAIRING CODE
            ================================================= */

            if (!socket.authState.creds.registered) {

                await delay(1500);

                const code =
                    await socket.requestPairingCode(num);

                const formattedCode =
                    code?.match(/.{1,4}/g)?.join("-") ||
                    code;

                if (!res.headersSent) {

                    res.json({
                        code: formattedCode
                    });

                }
            }

            /* =================================================
               COMMANDS
            ================================================= */

            const commandStart = Date.now();

            function runtime() {

                const seconds =
                    Math.floor(
                        (Date.now() - commandStart) / 1000
                    );

                const days =
                    Math.floor(seconds / 86400);

                const hours =
                    Math.floor(
                        (seconds % 86400) / 3600
                    );

                const minutes =
                    Math.floor(
                        (seconds % 3600) / 60
                    );

                const secs = seconds % 60;

                return `${days}d ${hours}h ${minutes}m ${secs}s`;
            }

            socket.ev.on(
                "messages.upsert",
                async ({ messages }) => {

                    try {

                        const msg = messages?.[0];

                        if (!msg?.message) return;

                        if (msg.key?.fromMe) return;

                        const remoteJid =
                            msg.key?.remoteJid;

                        if (!remoteJid) return;

                        if (
                            remoteJid ===
                            "status@broadcast"
                        ) {
                            return;
                        }

                        const text =
                            msg.message.conversation ||
                            msg.message.extendedTextMessage?.text ||
                            msg.message.imageMessage?.caption ||
                            msg.message.videoMessage?.caption ||
                            "";

                        const command =
                            text.trim().toLowerCase();

                        /* =========================
                           MENU
                        ========================= */

                        if (command === ".menu") {

                            await socket.sendMessage(
                                remoteJid,
                                {
                                    text:
`╭━━━〔 𓆩⚡𓆪 〕━━━╮
┃   ᴢᴀɴᴛᴀ-ᴍᴅ
┃   ᴡʜᴀᴛꜱᴀᴘᴘ ʙᴏᴛ
╰━━━━━━━━━━━━━━━╯

╭─〔 ᴄᴏᴍᴍᴀɴᴅs 〕
│
│ • .menu
│ • .alive
│ • .ping
│ • .runtime
│ • .help
│
╰━━━━━━━━━━━━━━━╯

> ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴢᴀɴᴛᴀ ᴏꜰᴄ`
                                }
                            );

                            return;
                        }

                        /* =========================
                           ALIVE
                        ========================= */

                        if (command === ".alive") {

                            await socket.sendMessage(
                                remoteJid,
                                {
                                    text:
`╭━━━〔 𓆩⚡𓆪 〕━━━╮
┃   ᴢᴀɴᴛᴀ-ᴍᴅ
╰━━━━━━━━━━━━━━━╯

│ ✓ ʙᴏᴛ : ᴏɴʟɪɴᴇ
│ ✓ sᴛᴀᴛᴜs : ᴀᴄᴛɪᴠᴇ
│ ✓ ʀᴜɴᴛɪᴍᴇ : ${runtime()}

> ᴢᴀɴᴛᴀ ᴏꜰᴄ`
                                }
                            );

                            return;
                        }

                        /* =========================
                           PING
                        ========================= */

                        if (command === ".ping") {

                            const start =
                                Date.now();

                            const sent =
                                await socket.sendMessage(
                                    remoteJid,
                                    {
                                        text:
                                            "🏓 ᴘɪɴɢ..."
                                    }
                                );

                            const latency =
                                Date.now() - start;

                            await socket.sendMessage(
                                remoteJid,
                                {
                                    text:
`🏓 ᴘᴏɴɢ!

⚡ ʟᴀᴛᴇɴᴄʏ : ${latency} ms`
                                }
                            );

                            return;
                        }

                        /* =========================
                           RUNTIME
                        ========================= */

                        if (command === ".runtime") {

                            await socket.sendMessage(
                                remoteJid,
                                {
                                    text:
`╭━━━〔 𓆩⚡𓆪 〕━━━╮
┃   ᴢᴀɴᴛᴀ-ᴍᴅ
╰━━━━━━━━━━━━━━━╯

⏱️ ʀᴜɴᴛɪᴍᴇ : ${runtime()}

> ᴢᴀɴᴛᴀ ᴏꜰᴄ`
                                }
                            );

                            return;
                        }

                        /* =========================
                           HELP
                        ========================= */

                        if (command === ".help") {

                            await socket.sendMessage(
                                remoteJid,
                                {
                                    text:
`╭━━━〔 𓆩⚡𓆪 〕━━━╮
┃   ᴢᴀɴᴛᴀ-ᴍᴅ ʜᴇʟᴘ
╰━━━━━━━━━━━━━━━╯

📚 ᴅɪsᴘᴏɴɪʙʟᴇ ᴄᴏᴍᴍᴀɴᴅs :

┌──────────────
│ .menu
│ → Afficher le menu
│
│ .alive
│ → Vérifier le statut du bot
│
│ .ping
│ → Vérifier la latence
│
│ .runtime
│ → Afficher le temps d'activité
│
│ .help
│ → Afficher cette aide
└──────────────

> ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴢᴀɴᴛᴀ ᴏꜰᴄ`
                                }
                            );

                            return;
                        }

                    } catch (err) {

                        console.log(
                            "❌ Command error:",
                            err.message
                        );

                    }

                }
            );

            /* =================================================
               CONNECTION UPDATE
            ================================================= */

            socket.ev.on(
                "connection.update",
                async (update) => {

                    const {
                        connection,
                        lastDisconnect
                    } = update;

                    /* =========================================
                       CONNECTED
                    ========================================= */

                    if (connection === "open") {

                        reconnecting = false;

                        console.log(
                            "✅ Zanta-MD connected"
                        );

                        try {

                            const userJid =
                                jidNormalizedUser(
                                    socket.user.id
                                );

                            const authPath =
                                `${sessionPath}/creds.json`;

                            if (
                                fs.existsSync(
                                    authPath
                                )
                            ) {

                                const creds =
                                    JSON.parse(
                                        fs.readFileSync(
                                            authPath,
                                            "utf8"
                                        )
                                    );

                                /* =================================
                                   SAVE TO MONGODB
                                ================================= */

                                await Session.findOneAndUpdate(
                                    {
                                        number: userJid
                                    },

                                    {
                                        number: userJid,
                                        creds: creds,
                                        updated_at:
                                            new Date()
                                    },

                                    {
                                        upsert: true,
                                        new: true
                                    }
                                );

                                console.log(
                                    "✅ Session saved to MongoDB:",
                                    userJid
                                );

                                /* =================================
                                   SUCCESS MESSAGE
                                ================================= */

                                await socket.sendMessage(
                                    userJid,
                                    {
                                        text:
`╔══════════════════╗
✨ ZANTA-MD CONNECTED ✨
╚══════════════════╝

🚀 Status : Connected
👤 User : ${userJid.split("@")[0]}
🗄 Database : MongoDB

Your session is securely saved.

Powered by Zanta OFC`
                                    }
                                );

                            }

                        } catch (err) {

                            console.log(
                                "❌ MongoDB session error:",
                                err.message
                            );

                        }

                    }

                    /* =========================================
                       CONNECTION CLOSED
                    ========================================= */

                    if (connection === "close") {

                        const statusCode =
                            lastDisconnect
                                ?.error
                                ?.output
                                ?.statusCode;

                        console.log(
                            "⚠️ Connection closed:",
                            statusCode
                        );

                        /* ==============================
                           LOGGED OUT
                        ============================== */

                        if (
                            statusCode ===
                            DisconnectReason.loggedOut
                        ) {

                            console.log(
                                "❌ Session logged out"
                            );

                            try {

                                const userJid =
                                    socket.user?.id
                                        ? jidNormalizedUser(
                                            socket.user.id
                                        )
                                        : null;

                                if (userJid) {

                                    await Session.deleteOne({
                                        number: userJid
                                    });

                                }

                            } catch (err) {

                                console.log(
                                    "❌ MongoDB delete error:",
                                    err.message
                                );

                            }

                            removeFile(
                                sessionPath
                            );

                            return;
                        }

                        /* ==============================
                           RECONNECT
                        ============================== */

                        if (!reconnecting) {

                            reconnecting = true;

                            console.log(
                                `🔄 Reconnecting in ${RECONNECT_DELAY / 1000}s...`
                            );

                            await delay(
                                RECONNECT_DELAY
                            );

                            try {

                                await startPair();

                            } catch (err) {

                                reconnecting = false;

                                console.log(
                                    "❌ Reconnect error:",
                                    err.message
                                );

                                await delay(
                                    RECONNECT_DELAY
                                );

                                startPair();

                            }

                        }

                    }

                }
            );

        } catch (err) {

            console.log(
                "❌ Pair/Socket error:",
                err.message
            );

            if (!res.headersSent) {

                res.json({
                    code:
                        "❌ Error getting code, try again"
                });

            }

            /* ==============================
               SAFE RECONNECT
            ============================== */

            if (!reconnecting) {

                reconnecting = true;

                await delay(
                    RECONNECT_DELAY
                );

                reconnecting = false;

                try {
                    await startPair();
                } catch (e) {
                    console.log(
                        "❌ Restart error:",
                        e.message
                    );
                }

            }

        }

    }

    /* =====================================================
       START
    ===================================================== */

    startPair().catch(err => {

        console.log(
            "❌ Fatal pair error:",
            err.message
        );

    });

});

/* =========================================================
   GLOBAL ANTI-CRASH
========================================================= */

process.on("uncaughtException", (err) => {

    console.log(
        "⚠️ Uncaught Exception:",
        err.message
    );

});

process.on("unhandledRejection", (reason) => {

    console.log(
        "⚠️ Unhandled Rejection:",
        reason
    );

});

module.exports = router;
