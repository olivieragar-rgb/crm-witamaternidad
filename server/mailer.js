import nodemailer from 'nodemailer';

// Envío de correo vía SMTP de Gmail con una "Contraseña de aplicación".
// Credenciales por variables de entorno (nunca en el código):
//   GMAIL_USER          -> tu dirección de Gmail (remitente)
//   GMAIL_APP_PASSWORD  -> contraseña de aplicación de 16 caracteres
const USER = process.env.GMAIL_USER;
const PASS = process.env.GMAIL_APP_PASSWORD;

export const mailerConfigured = () => !!(USER && PASS);

let transporter;
function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: USER, pass: PASS },
    });
  }
  return transporter;
}

/**
 * @param {{to:string, subject:string, html:string, attachments?:Array}} msg
 */
export async function sendMail({ to, subject, html, attachments }) {
  if (!mailerConfigured()) {
    const err = new Error('Email no configurado: faltan GMAIL_USER y GMAIL_APP_PASSWORD.');
    err.code = 'MAIL_NOT_CONFIGURED';
    throw err;
  }
  return getTransporter().sendMail({
    from: `Witamaternidad <${USER}>`,
    to,
    subject,
    html,
    attachments,
  });
}
