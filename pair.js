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

/* ---------------- SESSION SCHEMA ---------------- */

const SessionSchema = new mongoose.Schema({
  number: {
    type: String,
    unique: true
  },
  creds: Object,
  added_at: {
    type: Date,
    default: Date.now
  }
});

const Session =
  mongoose.models.Session ||
  mongoose.model("Session", SessionSchema);


/* ---------------- DELETE SESSION FILE ---------------- */

function removeFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.rmSync(filePath, {
        recursive: true,
        force: true
      });
    }
  } catch (err) {
    console.log("⚠️ Session cleanup error:", err.message);
  }
}


/* ---------------- NORMALIZE NUMBER ---------------- */

function normalizeNumber(number) {
  return String(number || "").replace(/\D/g, "");
}


/* ---------------- PAIR ROUTE ---------------- */

router.get("/", async (req, res) => {

  const id = makeid();
  const sessionPath = `./session${id}`;

  let num = normalizeNumber(req.query.number);

  if (!num) {
    return res.status(400).json({
      code: "❌ Number Missing"
    });
  }

  if (num.length < 8) {
    return res.status(400).json({
      code: "❌ Invalid Number"
    });
  }

  let socket = null;
  let finished = false;
  let pairingRequested = false;
  let retryCount = 0;

  const MAX_RETRIES = 3;


  /* ---------------- SEND RESULT ---------------- */

  function sendResult(data) {
    if (!res.headersSent) {
      res.json(data);
    }
  }


  /* ---------------- START PAIR ---------------- */

  async function startPair() {

    if (finished) return;

    retryCount++;

    if (retryCount > MAX_RETRIES) {

      console.log("❌ Maximum pairing retries reached");

      finished = true;

      sendResult({
        code: "❌ WhatsApp connection failed. Please try again."
      });

      removeFile(sessionPath);

      return;
    }

    console.log(
      `🔄 Starting WhatsApp connection (${retryCount}/${MAX_RETRIES})`
    );

    try {

      const { state, saveCreds } =
        await useMultiFileAuthState(sessionPath);


      const logger = pino({
        level: "fatal"
      });


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

        generateHighQualityLinkPreview: false
      });


      socket.ev.on(
        "creds.update",
        saveCreds
      );


      /* ---------------- CONNECTION UPDATE ---------------- */

      socket.ev.on(
        "connection.update",
        async (update) => {

          const {
            connection,
            lastDisconnect
          } = update;


          console.log(
            "📡 WhatsApp connection:",
            connection || "connecting"
          );


          /* -------- CONNECTION OPEN -------- */

          if (connection === "open") {

            console.log(
              "✅ WhatsApp connection opened"
            );

            try {

              await delay(2000);

              const authPath =
                `${sessionPath}/creds.json`;


              if (!fs.existsSync(authPath)) {

                console.log(
                  "⚠️ creds.json not found"
                );

                return;
              }


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


              /* -------- SAVE SESSION -------- */

              await Session.findOneAndUpdate(

                {
                  number: userJid
                },

                {
                  number: userJid,
                  creds: session
                },

                {
                  upsert: true,
                  new: true
                }

              );


              console.log(
                "✅ Session saved to MongoDB"
              );


              /* -------- SUCCESS MESSAGE -------- */

              const successMsg =
`╔══════════════════╗
✨ ZANTA-MD CONNECTED ✨
╚══════════════════╝

🚀 Status : Connected
👤 User : ${userJid.split("@")[0]}
🗄 Database : MongoDB

Your session is securely saved.

Powered by Zanta OFC`;


              try {

                await socket.sendMessage(
                  userJid,
                  {
                    text: successMsg
                  }
                );

              } catch (sendError) {

                console.log(
                  "⚠️ Success message error:",
                  sendError.message
                );

              }


              finished = true;

              await delay(2000);

              removeFile(sessionPath);

              try {

                socket.end(
                  new Error("Pairing completed")
                );

              } catch (_) {}


            } catch (err) {

              console.log(
                "❌ Session Save Error:",
                err
              );

            }

          }


          /* -------- CONNECTION CLOSED -------- */

          if (
            connection === "close" &&
            !finished
          ) {

            const statusCode =
              lastDisconnect?.error?.output?.statusCode;

            console.log(
              "❌ WhatsApp connection closed. Status:",
              statusCode
            );


            /*
             * 401 = Logged out / unauthorized.
             * Do not retry indefinitely.
             */

            if (statusCode === 401) {

              finished = true;

              sendResult({
                code: "❌ WhatsApp session unauthorized. Try again."
              });

              removeFile(sessionPath);

              return;
            }


            /*
             * 428 = Connection Closed.
             * Retry the socket instead of immediately
             * returning an error to the user.
             */

            if (statusCode === 428) {

              console.log(
                "⚠️ WhatsApp returned 428. Retrying..."
              );

            }


            if (retryCount < MAX_RETRIES) {

              await delay(4000);

              if (!finished) {
                await startPair();
              }

            } else {

              finished = true;

              sendResult({
                code: "❌ Connection closed. Please try again."
              });

              removeFile(sessionPath);

            }

          }

        }
      );


      /* ------------------------------------------------
         WAIT BEFORE REQUESTING PAIRING CODE
         ------------------------------------------------ */

      if (!state.creds.registered) {

        /*
         * IMPORTANT:
         * Do not request the pairing code immediately.
         * The WhatsApp WebSocket needs time to initialize.
         */

        console.log(
          "⏳ Waiting for WhatsApp socket..."
        );

        await delay(5000);


        if (
          finished ||
          !socket
        ) {
          return;
        }


        /*
         * Prevent duplicate pairing-code requests.
         */

        if (pairingRequested) {
          return;
        }

        pairingRequested = true;


        try {

          num = normalizeNumber(num);

          console.log(
            "🔑 Requesting pairing code for:",
            num
          );


          const code =
            await socket.requestPairingCode(num);


          if (!code) {

            throw new Error(
              "WhatsApp returned an empty pairing code"
            );

          }


          const formattedCode =
            String(code)
              .match(/.{1,4}/g)
              ?.join("-") || code;


          console.log(
            "✅ Pairing code generated:",
            formattedCode
          );


          sendResult({
            code: formattedCode
          });


        } catch (pairError) {

          pairingRequested = false;

          console.log(
            "❌ Pairing Code Error:",
            pairError?.message || pairError
          );


          /*
           * If the socket closed while requesting
           * the code, let connection.update handle retry.
           */

          if (
            String(pairError?.message || "")
              .toLowerCase()
              .includes("connection closed")
          ) {

            console.log(
              "🔄 Connection closed during pairing. Waiting for retry..."
            );

            return;
          }


          finished = true;

          sendResult({
            code: "❌ Error getting pairing code. Please try again."
          });

          removeFile(sessionPath);

        }

      }

    } catch (err) {

      console.log(
        "❌ Pair Error:",
        err
      );


      if (
        !finished &&
        retryCount < MAX_RETRIES
      ) {

        await delay(4000);

        await startPair();

        return;
      }


      if (!finished) {

        finished = true;

        sendResult({
          code: "❌ Error starting WhatsApp connection."
        });

        removeFile(sessionPath);

      }

    }

  }


  /* ---------------- START ---------------- */

  await startPair();

});


module.exports = router;
