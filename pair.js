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
  jidNormalizedUser
} = require("@whiskeysockets/baileys");

const router = express.Router();

/* =========================================================
   MODÈLE DE SESSION
   ========================================================= */

const SessionSchema = new mongoose.Schema({
  number: {
    type: String,
    unique: true
  },
  creds: Object,
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
   OUTILS
   ========================================================= */

function removeFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.rmSync(filePath, {
        recursive: true,
        force: true
      });
    }
  } catch (error) {
    console.log(
      "⚠️ Erreur de nettoyage de session :",
      error.message
    );
  }
}

function normalizeNumber(number) {
  return String(number || "").replace(/\D/g, "");
}

function getText(message) {
  return (
    message?.conversation ||
    message?.extendedTextMessage?.text ||
    message?.imageMessage?.caption ||
    message?.videoMessage?.caption ||
    ""
  ).trim();
}


/* =========================================================
   COMMANDES ZANTA-MD
   ========================================================= */

async function handleCommand(sock, msg) {
  try {
    if (!msg || !msg.message) return;

    if (msg.key?.fromMe) return;

    const jid = msg.key?.remoteJid;

    if (!jid || jid === "status@broadcast") return;

    const text = getText(msg.message);

    if (!text.startsWith(".")) return;

    const parts = text
      .slice(1)
      .trim()
      .split(/\s+/);

    const command =
      (parts.shift() || "").toLowerCase();

    const args = parts;

    const ownerNumber =
      normalizeNumber(process.env.OWNER_NUMBER);

    const ownerName =
      process.env.OWNER_NAME ||
      "Propriétaire de ZANTA-MD";


    /* =====================================================
       .alive
       ===================================================== */

    if (command === "alive") {

      await sock.sendMessage(jid, {
        text:
`╔══════════════════════════════╗
║        ZANTA-MD ACTIF        ║
╚══════════════════════════════╝

Le bot est toujours vivant.
Il fonctionne correctement et reste connecté.

▸ Statut : Actif
▸ Service : En ligne
▸ Version : ${process.env.BOT_VERSION || "0.0.1"}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ZANTA-MD • The Future of WhatsApp`
      });

      return;
    }


    /* =====================================================
       .ping
       ===================================================== */

    if (command === "ping") {

      const started = Date.now();

      const sent = await sock.sendMessage(jid, {
        text:
          "⏳ Vérification de la connexion..."
      });

      const latency =
        Date.now() - started;

      await sock.sendMessage(
        jid,
        {
          text:
`╔══════════════════════════════╗
║         ZANTA-MD PING        ║
╚══════════════════════════════╝

✓ Connexion : Stable
✓ Latence : ${latency} ms
✓ Statut : En ligne`
        },
        {
          quoted: sent
        }
      );

      return;
    }


    /* =====================================================
       .menu / .help
       ===================================================== */

    if (
      command === "menu" ||
      command === "help"
    ) {

      await sock.sendMessage(jid, {
        text:
`╔══════════════════════════════╗
║          ZANTA-MD           ║
║       MENU PRINCIPAL        ║
╚══════════════════════════════╝

┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ INFORMATIONS                 ┃
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫
┃ • .alive                     ┃
┃ • .ping                      ┃
┃ • .info                      ┃
┃ • .owner                     ┃
┃ • .menu                      ┃
┃ • .help                      ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

Bot WhatsApp Multi-Device
Version : ${process.env.BOT_VERSION || "0.0.1"}

Tapez .menu pour afficher ce menu.`
      });

      return;
    }


    /* =====================================================
       .owner
       ===================================================== */

    if (command === "owner") {

      const numberText =
        ownerNumber
          ? `+${ownerNumber}`
          : "Non configuré";

      await sock.sendMessage(jid, {
        text:
`╔══════════════════════════════╗
║        PROPRIÉTAIRE          ║
╚══════════════════════════════╝

Nom : ${ownerName}
Numéro : ${numberText}

Créateur de ZANTA-MD.`
      });

      return;
    }


    /* =====================================================
       .info
       ===================================================== */

    if (command === "info") {

      const botNumber =
        sock.user?.id
          ? jidNormalizedUser(
              sock.user.id
            ).split("@")[0]
          : "Inconnu";

      await sock.sendMessage(jid, {
        text:
`╔══════════════════════════════╗
║        INFORMATIONS          ║
╚══════════════════════════════╝

Nom : ZANTA-MD
Version : ${process.env.BOT_VERSION || "0.0.1"}
Numéro : +${botNumber}
Statut : En ligne
Mode : Multi-Device
Base de données : MongoDB

Le bot est actuellement opérationnel.`
      });

      return;
    }


    /* =====================================================
       COMMANDE INCONNUE
       ===================================================== */

    await sock.sendMessage(jid, {
      text:
`❌ Commande inconnue.

Utilisez .menu pour voir les commandes disponibles.`
    });

  } catch (error) {

    console.log(
      "❌ Erreur lors du traitement d'une commande :",
      error.message
    );
  }
}


/* =========================================================
   ROUTE DE PAIRING
   ========================================================= */

router.get("/", async (req, res) => {

  const id = makeid();

  const sessionPath =
    `./session${id}`;

  let number =
    normalizeNumber(req.query.number);


  /* ---------------- VALIDATION NUMÉRO ---------------- */

  if (!number) {

    return res.status(400).json({
      code: "❌ Numéro manquant."
    });
  }

  if (number.length < 8) {

    return res.status(400).json({
      code: "❌ Numéro invalide."
    });
  }


  let socket = null;

  let pairingCodeSent = false;

  let responseSent = false;

  let stopped = false;

  let reconnecting = false;

  let retryCount = 0;

  const MAX_RETRIES = 5;


  /* =====================================================
     RÉPONSE HTTP
     ===================================================== */

  function sendPairingResponse(data) {

    if (
      !responseSent &&
      !res.headersSent
    ) {

      responseSent = true;

      res.json(data);
    }
  }


  /* =====================================================
     CONNEXION WHATSAPP
     ===================================================== */

  async function startSocket(
    requestPairingCode = false
  ) {

    if (stopped) return;

    if (reconnecting) return;

    reconnecting = true;


    try {

      const {
        state,
        saveCreds
      } = await useMultiFileAuthState(
        sessionPath
      );


      const logger =
        pino({
          level: "fatal"
        });


      socket = makeWASocket({

        auth: {
          creds: state.creds,

          keys:
            makeCacheableSignalKeyStore(
              state.keys,
              logger
            )
        },

        printQRInTerminal: false,

        logger,

        browser:
          Browsers.ubuntu("Chrome"),

        markOnlineOnConnect: false,

        generateHighQualityLinkPreview:
          false
      });


      /* ---------------- SAUVEGARDE CREDENTIALS ---------------- */

      socket.ev.on(
        "creds.update",
        saveCreds
      );


      /* =====================================================
         RÉCEPTION DES MESSAGES / COMMANDES
         ===================================================== */

      socket.ev.on(
        "messages.upsert",
        async ({ messages }) => {

          for (
            const msg of messages || []
          ) {

            await handleCommand(
              socket,
              msg
            );
          }
        }
      );


      /* =====================================================
         ÉTAT DE LA CONNEXION
         ===================================================== */

      socket.ev.on(
        "connection.update",
        async (update) => {

          const {
            connection,
            lastDisconnect
          } = update;


          /* ---------------- CONNECTING ---------------- */

          if (
            connection === "connecting"
          ) {

            console.log(
              "⏳ Connexion à WhatsApp en cours..."
            );
          }


          /* ---------------- OPEN ---------------- */

          if (
            connection === "open"
          ) {

            reconnecting = false;

            retryCount = 0;

            console.log(
              "✅ WhatsApp connecté avec succès."
            );


            try {

              const authPath =
                `${sessionPath}/creds.json`;


              if (
                fs.existsSync(authPath)
              ) {

                const session =
                  JSON.parse(
                    fs.readFileSync(
                      authPath,
                      "utf8"
                    )
                  );


                const userJid =
                  jidNormalizedUser(
                    socket.user.id
                  );


                /* -------- MongoDB -------- */

                await Session.findOneAndUpdate(

                  {
                    number: userJid
                  },

                  {
                    number: userJid,

                    creds: session,

                    updated_at:
                      new Date()
                  },

                  {
                    upsert: true,

                    new: true
                  }
                );


                console.log(
                  "✅ Session enregistrée dans MongoDB."
                );


                /* -------- MESSAGE DE SUCCÈS -------- */

                const successMessage =
`╔══════════════════════════════╗
║       ZANTA-MD CONNECTÉ      ║
╚══════════════════════════════╝

Connexion réussie.

▸ Statut : En ligne
▸ Mode : Multi-Device
▸ Base : MongoDB
▸ Version : ${process.env.BOT_VERSION || "0.0.1"}

Utilisez .menu pour afficher les commandes.`;


                await socket.sendMessage(
                  userJid,
                  {
                    text:
                      successMessage
                  }
                );
              }


            } catch (error) {

              console.log(
                "❌ Erreur lors de l'enregistrement de la session :",
                error.message
              );
            }
          }


          /* ---------------- CLOSE ---------------- */

          if (
            connection === "close" &&
            !stopped
          ) {

            reconnecting = false;


            const statusCode =
              lastDisconnect
                ?.error
                ?.output
                ?.statusCode;


            console.log(
              `⚠️ Connexion WhatsApp fermée. Code : ${
                statusCode || "inconnu"
              }`
            );


            /* -------- 401 -------- */

            if (
              statusCode === 401
            ) {

              console.log(
                "❌ Session WhatsApp invalidée. Un nouveau pairing est nécessaire."
              );


              stopped = true;

              removeFile(
                sessionPath
              );

              return;
            }


            /* -------- RECONNEXION -------- */

            if (
              retryCount <
              MAX_RETRIES
            ) {

              retryCount++;


              console.log(
                `🔄 Tentative de reconnexion ${retryCount}/${MAX_RETRIES}...`
              );


              await delay(5000);


              if (!stopped) {

                await startSocket(
                  false
                );
              }


            } else {

              console.log(
                "❌ Nombre maximum de tentatives de reconnexion atteint."
              );
            }
          }
        }
      );


      reconnecting = false;


      /* =====================================================
         CODE DE PAIRING
         ===================================================== */

      if (
        requestPairingCode &&
        !state.creds.registered
      ) {

        console.log(
          "⏳ Préparation du code de connexion WhatsApp..."
        );


        /*
         * On attend que le socket ait
         * suffisamment de temps pour
         * établir la connexion.
         */

        await delay(5000);


        if (
          stopped ||
          !socket ||
          pairingCodeSent
        ) {
          return;
        }


        try {

          number =
            normalizeNumber(number);


          console.log(
            "🔑 Demande du code de connexion..."
          );


          const code =
            await socket.requestPairingCode(
              number
            );


          if (!code) {

            throw new Error(
              "WhatsApp n'a retourné aucun code."
            );
          }


          const formattedCode =
            String(code)
              .match(/.{1,4}/g)
              ?.join("-") ||
            String(code);


          pairingCodeSent = true;


          console.log(
            `✅ Code de connexion généré : ${formattedCode}`
          );


          sendPairingResponse({
            code:
              formattedCode
          });


        } catch (error) {

          console.log(
            "❌ Erreur lors de la génération du code :",
            error.message
          );


          if (!responseSent) {

            sendPairingResponse({
              code:
                "❌ Impossible de générer le code. Veuillez réessayer."
            });
          }
        }
      }


    } catch (error) {

      reconnecting = false;


      console.log(
        "❌ Erreur de connexion WhatsApp :",
        error.message
      );


      if (!responseSent) {

        sendPairingResponse({
          code:
            "❌ Erreur de connexion à WhatsApp. Veuillez réessayer."
        });
      }
    }
  }


  /* =====================================================
     DÉMARRAGE
     ===================================================== */

  await startSocket(true);
});


module.exports = router;
