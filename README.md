# SOTRA Backend

API backend for the SOTRA application.

## Requirements

- Node.js 22 or newer
- MySQL

## Setup

1. Install dependencies:

   ```sh
   npm ci
   ```

2. Copy `.env.example` to `.env` and set the database and SMTP values for your environment.
3. Create the configured MySQL database, then apply the Drizzle migrations:

   ```sh
   npm run db:migrate
   ```

4. Start the development server:

   ```sh
   npm run dev
   ```

The API listens on port `5000` by default. Build with `npm run build` and run the compiled server with `npm start`.

When the DG approves a bon, the backend records the BASV and DG identities and validation times, then stores a receipt snapshot in the same transaction. The agent can print or save that receipt as a PDF from the Bons page to present at the cashier.

After the agent confirms receiving the reimbursement, the backend generates a separate payment-confirmation receipt. The BASV transmits it from the Reimbursements page, after which the agent can print or save it as a PDF. No receipt file upload is required.

Never commit `.env` or real credentials. Use `.env.example` as the configuration template.
