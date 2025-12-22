// constants.js

// Fill these in with your own values before running the bot or the deploy-commands script.
// IMPORTANT: Do not commit real tokens to a public repository.

const BOT_TOKEN = process.env.BOT_TOKEN || 'YOUR_BOT_TOKEN_HERE';       // Bot token from https://discord.com/developers
const CLIENT_ID = '1444804204538364070';       // Application (bot) client ID
const GUILD_ID = '1434960595928617041';         // Development guild ID for registering commands

// IANA timezone used to interpret /test_session_start start_time (ex: America/New_York)
const TEST_SESSION_TIMEZONE = 'America/New_York';

module.exports = {
  BOT_TOKEN,
  CLIENT_ID,
  GUILD_ID,
  TEST_SESSION_TIMEZONE,
};