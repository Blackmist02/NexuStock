const nodemailer = require('nodemailer');
const config = require('../config');

let transport = null;

async function enviarCorreo(to, subject, text) {
  if (!config.smtpUrl) {
    // Sin SMTP configurado (desarrollo): el mensaje, con el enlace de recuperación, queda en el log del backend.
    console.log(`[correo no enviado: SMTP_URL no configurado]\n  Para: ${to}\n  Asunto: ${subject}\n  ${text}`);
    return;
  }
  transport = transport || nodemailer.createTransport(config.smtpUrl);
  await transport.sendMail({ from: config.mailFrom, to, subject, text });
}

module.exports = { enviarCorreo };
