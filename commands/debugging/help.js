const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const HELP_SECTIONS = [
  {
    name: 'Debug & Utility',
    commands: [
      {
        key: 'help',
        line: '• `/help` — Show this help message.',
      },
      {
        key: 'ping',
        line: '• `/ping` — Show bot latency and network stats.',
      },
      {
        key: 'echo',
        line:
          '• `/echo text: [attachment:] [embed:]` — Echo text, emojis, and optional attachments publicly while confirming to you ephemerally.',
      },
      {
        key: 'roll',
        line: '• `/roll [sides:]` — Roll a die (default 6 sides) and show debug info.',
      },
    ],
  },
  {
    name: 'Moderation — Core actions',
    commands: [
      {
        key: 'ban',
        line:
          '• `/ban target: reason:` — Ban a member, DM them the reason, and log a Moderation ID.',
      },
      {
        key: 'kick',
        line:
          '• `/kick target: reason:` — Kick a member, DM them the reason, and log a Moderation ID.',
      },
      {
        key: 'mute',
        line:
          '• `/mute target: minutes: reason:` — Timeout a member for a period and DM them the reason.',
      },
      {
        key: 'warn',
        line:
          '• `/warn target: reason:` — Warn a member via DM, track active warns, and log a Moderation ID.',
      },
      {
        key: 'dm',
        line: '• `/dm target: text:` — Send a DM to a user through the bot.',
      },
    ],
  },
  {
    name: 'Moderation — Cleanup',
    commands: [
      {
        key: 'clear',
        line:
          '• `/clear days:` — Clear messages from **this channel** from the last N days.',
      },
      {
        key: 'serverclear',
        line:
          '• `/serverclear player:` — Clear a user\'s messages across text channels (within recent history).',
      },
      {
        key: 'purge',
        line:
          '• `/purge channel: amount:` — Clear a specified number of recent messages from a chosen text channel (up to 100 at a time).',
      },
      {
        key: 'react_scrub',
        line:
          '• `/react_scrub user:` — Remove a user\'s reactions across accessible channels (best-effort, recent history).',
      },
    ],
  },
  {
    name: 'Moderation — Info, notes, and undo',
    commands: [
      {
        key: 'info',
        line:
          '• `/info [target:]` — Show account info, moderation status (left/kicked/banned), warnings, invalidated warns, and notes.',
      },
      {
        key: 'note',
        line:
          '• `/note target: text:` — Attach a moderation note to a user (shown in `/info`).',
      },
      {
        key: 'ms_check',
        line:
          '• `/ms_check [moderator:]` — Show a moderator scorecard with tickets accepted/denied and moderation actions.',
      },
      {
        key: 'undomoderation',
        line:
          '• `/undomoderation type: moderation_id: reason:` — Undo a previous `warn`/`kick`/`ban` by Moderation ID (and unban when possible).',
      },
    ],
  },
  {
    name: 'Admin & Configuration',
    commands: [
      {
        key: 'setchannel',
        line:
          '• `/setchannel kind: channel:` — Configure which channel is used for command logs or DM forwarding.',
      },
      {
        key: 'emergencymaintenance',
        line:
          '• `/emergencymaintenance` — Developer-only emergency maintenance command that applies the "." role to the caller for handling critical incidents in this server.',
      },
    ],
  },
  {
    name: 'Polls',
    commands: [
      {
        key: 'poll',
        line:
          '• `/poll question: option1: [option2..option10]` — Create a numbered poll with up to 10 options; users vote via number emojis and can have only one active vote.',
      },
      {
        key: 'pollclose',
        line:
          '• `/pollclose` — Close your most recent open poll and report the highest-voted option (or a tie).',
      },
    ],
  },
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show available commands and their usage.'),
  async execute(interaction) {
    const allCommands = interaction.client?.commands ?? null;

    const embed = new EmbedBuilder()
      .setTitle('Bot Help')
      .setColor(0x005865f2)
      .setDescription('Summary of all available slash commands and how to use them.');

    for (const section of HELP_SECTIONS) {
      const lines = section.commands
        .filter(entry => !allCommands || allCommands.has(entry.key))
        .map(entry => entry.line);

      if (!lines.length) {
        continue;
      }

      embed.addFields({
        name: section.name,
        value: lines.join('\n'),
        inline: false,
      });
    }

    embed.setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
