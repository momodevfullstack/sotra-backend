import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

const isConfigured = Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASSWORD && env.MAIL_FROM);

const transporter = isConfigured
  ? nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: {
        user: env.SMTP_USER,
        pass: env.SMTP_PASSWORD,
      },
    })
  : null;

export async function sendUserWelcomeEmail(input: {
  email: string;
  nom: string;
  prenoms?: string;
  profil: string;
  temporaryPassword: string;
}) {
  if (!transporter) {
    console.warn('SMTP non configuré : e-mail utilisateur non envoyé.');
    return false;
  }

  await transporter.sendMail({
    from: env.MAIL_FROM,
    to: input.email,
    subject: 'Votre accès à la plateforme SOTRA',
    text: [
      `Bonjour ${input.prenoms || input.nom},`,
      '',
      'Votre compte a été créé sur la plateforme SOTRA.',
      `Profil : ${input.profil}`,
      `Identifiant : ${input.email}`,
      `Mot de passe temporaire : ${input.temporaryPassword}`,
      '',
      `Adresse de connexion : ${env.FRONTEND_URL}`,
      '',
      'Pour votre sécurité, modifiez ce mot de passe après votre première connexion.',
      '',
      'Cordialement,',
      'Administration SOTRA',
    ].join('\n'),
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#1e293b">
        <h2 style="color:#6a8c3a">Votre accès à la plateforme SOTRA</h2>
        <p>Bonjour ${input.prenoms || input.nom},</p>
        <p>Votre compte a été créé sur la plateforme SOTRA.</p>
        <p><strong>Profil :</strong> ${input.profil}<br />
        <strong>Identifiant :</strong> ${input.email}<br />
        <strong>Mot de passe temporaire :</strong> ${input.temporaryPassword}</p>
        <p><a href="${env.FRONTEND_URL}" style="display:inline-block;background:#7ca047;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none">Accéder à la plateforme</a></p>
        <p>Pour votre sécurité, modifiez ce mot de passe après votre première connexion.</p>
        <p>Cordialement,<br />Administration SOTRA</p>
      </div>
    `,
  });

  return true;
}
