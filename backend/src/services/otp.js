import crypto from 'crypto';
import nodemailer from 'nodemailer';
import { redis } from '../redis.js';

// Setup optional Nodemailer transporter if SMTP config is provided in .env
let transporter = null;
if (process.env.SMTP_HOST && process.env.SMTP_USER) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_PORT === '465',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
}

/**
 * Generate a cryptographically secure 6-digit OTP
 */
export function generateOTP() {
  return crypto.randomInt(100000, 999999).toString();
}

/**
 * Send OTP via Nodemailer SMTP or fallback to console
 */
export async function sendOTPEmail(email, otp) {
  if (transporter) {
    try {
      await transporter.sendMail({
        from: process.env.SMTP_FROM || 'CodeRank <noreply@coderank.local>',
        to: email,
        subject: 'Your CodeRank Verification OTP',
        text: `Your CodeRank verification code is: ${otp}\nThis code will expire in 5 minutes.`,
        html: `<div style="font-family: sans-serif; padding: 20px;">
          <h2>CodeRank Email Verification</h2>
          <p>Your one-time verification code is:</p>
          <h1 style="color: #6366f1; letter-spacing: 4px;">${otp}</h1>
          <p>This code will expire in 5 minutes (300 seconds).</p>
        </div>`
      });
      console.log(`[OTP] Sent verification email to ${email}`);
      return true;
    } catch (err) {
      console.warn(`[OTP] SMTP send failed (${err.message}). Using console fallback.`);
    }
  }

  // Mandatory demo fallback: log prominently to server console
  console.log('\n' + '='.repeat(60));
  console.log(' [DEMO OTP CONSOLE FALLBACK]');
  console.log(` Recipient: ${email}`);
  console.log(` Code:      ${otp}`);
  console.log(' TTL:       300 seconds (5 minutes)');
  console.log('='.repeat(60) + '\n');
  return true;
}

/**
 * Store OTP in Redis with 300-second TTL
 */
export async function storeOTP(email, otp) {
  const key = `otp:${email.toLowerCase()}`;
  // Redis command: SET key value EX seconds
  // Atomic key set with 300 second (5 min) time-to-live
  await redis.set(key, otp, 'EX', 300);
}

/**
 * Store pending user registration data in Redis Hash with 600-second TTL
 */
export async function storePendingRegistration(email, data) {
  const key = `pending:${email.toLowerCase()}`;
  const pipeline = redis.pipeline();
  // Redis command: HSET key field value ...
  // Store staged registration data as a Redis Hash
  pipeline.hset(key, {
    username: data.username,
    email: data.email.toLowerCase(),
    passwordHash: data.passwordHash,
    college: data.college || '',
    createdAt: Date.now().toString()
  });
  // Redis command: EXPIRE key seconds
  // Automatically evict unverified registration attempts after 10 minutes (600s)
  pipeline.expire(key, 600);
  await pipeline.exec();
}
