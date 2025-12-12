const fs = require('node:fs');
const path = require('node:path');
const { REST, Routes } = require('discord.js');
const { BOT_TOKEN, CLIENT_ID, GUILD_ID } = require('./constants');

const commands = [];

function collectCommands(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      collectCommands(fullPath);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      const command = require(fullPath);
      if ('data' in command && 'execute' in command) {
        commands.push(command.data.toJSON());
      } else {
        console.warn(`[WARNING] The command at ${fullPath} is missing a required "data" or "execute" property.`);
      }
    }
  }
}

const commandsPath = path.join(__dirname, 'commands');
collectCommands(commandsPath);

if (!BOT_TOKEN || BOT_TOKEN === 'YOUR_BOT_TOKEN_HERE') {
  console.error('Please set BOT_TOKEN in constants.js before deploying commands.');
  process.exit(1);
}

if (!CLIENT_ID || CLIENT_ID === 'YOUR_CLIENT_ID_HERE') {
  console.error('Please set CLIENT_ID in constants.js before deploying commands.');
  process.exit(1);
}

if (!GUILD_ID || GUILD_ID === 'YOUR_GUILD_ID_HERE') {
  console.error('Please set GUILD_ID in constants.js before deploying commands.');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);

(async () => {
  try {
    console.log(`Started refreshing application (/) commands for guild ${GUILD_ID}.`);

    const data = await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands },
    );

    console.log(`Successfully reloaded ${data.length} application (/) commands.`);
  } catch (error) {
    console.error('Error reloading application (/) commands:', error);
  }
})();
