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

Never commit `.env` or real credentials. Use `.env.example` as the configuration template.
