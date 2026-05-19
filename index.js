require('dotenv').config();

const express = require('express');
const Stripe = require('stripe');
const crypto = require('crypto');
const { Resend } = require('resend');
const { createClient } = require('@supabase/supabase-js');

const app = express();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function generateLicense() {
  return crypto.randomBytes(16).toString('hex').toUpperCase();
}

// Stripe webhook route MUST be before express.json()
app.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const sig = req.headers['stripe-signature'];

    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.log('❌ Webhook signature failed:', err.message);
      return res.sendStatus(400);
    }

    if (event.type !== 'checkout.session.completed') {
      return res.sendStatus(200);
    }

    console.log('✅ Checkout completed');

    const session = event.data.object;
    const email = session.customer_details?.email;

    if (!email) {
      console.log('⚠️ No email found on session');
      return res.sendStatus(200);
    }

    const licenseKey = generateLicense();

    const { error } = await supabase.from('licenses').insert({
      email,
      license_key: licenseKey
    });

    if (error) {
      console.log('❌ Supabase insert failed:', error.message);
      return res.sendStatus(500);
    }

    console.log('🎟️ License saved to Supabase');

    try {
      await resend.emails.send({
        from: 'onboarding@resend.dev',
        to: email,
        subject: 'Your PricePeek Premium License',
        html: `
          <h2>Welcome to PricePeek Premium 🎉</h2>
          <p>Your license key is:</p>
          <h3>${licenseKey}</h3>
          <p>Paste this into PricePeek to unlock premium.</p>
        `
      });

      console.log('📧 Email sent');
    } catch (err) {
      console.log('❌ Email failed:', err.message);
    }

    res.sendStatus(200);
  }
);

app.use(express.json());

app.get('/', (req, res) => {
  res.send('PricePeek server running 🟢');
});

app.get('/validate', async (req, res) => {
  const { key } = req.query;

  if (!key) {
    return res.status(400).json({ valid: false, error: 'Missing license key' });
  }

  const { data, error } = await supabase
    .from('licenses')
    .select('id, email, license_key')
    .eq('license_key', key)
    .maybeSingle();

  if (error) {
    console.log('❌ Supabase validate failed:', error.message);
    return res.status(500).json({ valid: false });
  }

  return res.json({ valid: !!data });
});

app.listen(3000, () => {
  console.log('Server running on port 3000');
});