const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const CHANNELS_FILE = path.join(DATA_DIR, 'channels.json');

function safeReadJson(filename) {
  try {
    const fullPath = path.join(DATA_DIR, filename);
    if (!fs.existsSync(fullPath)) {
      return null;
    }

    const raw = fs.readFileSync(fullPath, 'utf8');
    if (!raw) {
      return null;
    }

    return JSON.parse(raw);
  } catch (error) {
    console.error(`[setchannel] Failed to read ${filename}:`, error);
    return null;
  }
}

function truncate(text, maxLen) {
  const raw = typeof text === 'string' ? text : '';
  if (raw.length <= maxLen) return raw;
  return `${raw.slice(0, Math.max(0, maxLen - 1))}…`;
}

function mentionChannel(channelId) {
  if (!channelId) return '(not set)';
  return `<#${channelId}> (${channelId})`;
}

function censorToken(token) {
  const raw = typeof token === 'string' ? token : '';
  const trimmed = raw.trim();
  if (!trimmed) return '';

  // Preserve Discord mentions/markup.
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
    return trimmed;
  }

  // Preserve emoji codes like :foo:
  if (trimmed.startsWith(':') && trimmed.endsWith(':') && trimmed.length >= 3) {
    return trimmed;
  }

  const letters = trimmed.replaceAll(/[^a-zA-Z0-9]/g, '');
  if (!letters) {
    return '▇';
  }

  const first = letters.slice(0, 1);
  const maskLen = Math.min(8, Math.max(3, letters.length - 1));
  return `${first}${'▇'.repeat(maskLen)}`;
}

function censorPhrase(phrase) {
  const raw = typeof phrase === 'string' ? phrase.trim() : '';
  if (!raw) return '(empty)';

  if (/^https?:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      const pathPart = url.pathname && url.pathname !== '/' ? url.pathname : '';
      const shown = `${url.origin}${pathPart}`;
      return truncate(`[link] ${shown}`, 80);
    } catch {
      return '[link]';
    }
  }

  const parts = raw.split(/\s+/g).filter(Boolean);
  const censored = parts.map(censorToken).filter(Boolean).join(' ');
  return truncate(censored || '[censored]', 120);
}

function countNestedArrays(obj) {
  if (!obj || typeof obj !== 'object') return 0;
  let total = 0;
  for (const value of Object.values(obj)) {
    if (Array.isArray(value)) total += value.length;
  }
  return total;
}

function getGuildStore(store, guildId) {
  if (!store || typeof store !== 'object' || !guildId) return null;
  const bucket = store[guildId];
  return bucket && typeof bucket === 'object' ? bucket : null;
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadChannels() {
  ensureDataDir();
  if (!fs.existsSync(CHANNELS_FILE)) return {};

  try {
    const raw = fs.readFileSync(CHANNELS_FILE, 'utf8');
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    console.error('Failed to read channels.json, starting fresh:', error);
    return {};
  }
}

function saveChannels(store) {
  ensureDataDir();
  try {
    fs.writeFileSync(CHANNELS_FILE, JSON.stringify(store, null, 2), 'utf8');
  } catch (error) {
    console.error('Failed to write channels.json:', error);
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setchannel')
    .setDescription('Configure which channel is used for command logs/DM forwarding, or view current configs.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addStringOption(option =>
      option
        .setName('kind')
        .setDescription('What this channel will be used for')
        .setRequired(true)
        .addChoices(
          { name: 'Command logs', value: 'command_logs' },
          { name: 'DM forwarding', value: 'dm_forwarding' },
          { name: 'Current Configs', value: 'current_configs' },
        ),
    )
    .addChannelOption(option =>
      option
        .setName('channel')
        .setDescription('Channel to use for this purpose')
        .setRequired(false),
    ),
  async execute(interaction) {
    if (!interaction.guild) {
      await interaction.reply({
        content: 'This command can only be used in a server.',
        ephemeral: true,
      });
      return;
    }

    const kind = interaction.options.getString('kind', true);

    if (kind === 'current_configs') {
      const guildId = interaction.guildId;
      const nowUnix = Math.floor(Date.now() / 1000);

      const channelsConfig = loadChannels();
      const servers = safeReadJson('servers.json');
      const automod = safeReadJson('automod.json');
      const noping = safeReadJson('noping.json');
      const afk = safeReadJson('afk.json');
      const tickets = safeReadJson('tickets.json');
      const warnings = safeReadJson('warnings.json');
      const notes = safeReadJson('notes.json');
      const polls = safeReadJson('polls.json');
      const testSessions = safeReadJson('test_sessions.json');
      const moderations = safeReadJson('moderations.json');

      const linesForObj = (obj) => {
        if (!obj || typeof obj !== 'object') return '(none)';
        const entries = Object.entries(obj);
        if (!entries.length) return '(none)';
        entries.sort(([a], [b]) => a.localeCompare(b));
        return entries
          .map(([key, value]) => `• **${key}**: ${mentionChannel(value)}`)
          .join('\n');
      };

      const serverStore = getGuildStore(servers, guildId);
      const welcomeEnabled = serverStore ? !!serverStore.welcomeEnabled : false;
      const welcomeChannelId = serverStore && serverStore.welcomeChannelId ? serverStore.welcomeChannelId : null;
      const welcomeTemplateRaw = serverStore && typeof serverStore.welcomeMessageTemplate === 'string'
        ? serverStore.welcomeMessageTemplate
        : null;
      const welcomeTemplate = welcomeTemplateRaw ? truncate(welcomeTemplateRaw, 160) : '(default)';

      const automodStore = getGuildStore(automod, guildId);
      const blocked = Array.isArray(automodStore?.words) ? automodStore.words : [];
      const reverse = Array.isArray(automodStore?.reverseWords) ? automodStore.reverseWords : [];

      const sortBySetAtDesc = (a, b) => {
        const at = a && a.setAt ? Date.parse(a.setAt) : -Infinity;
        const bt = b && b.setAt ? Date.parse(b.setAt) : -Infinity;
        return bt - at;
      };

      const formatAutomodSample = (items, limit) => {
        const safe = Array.isArray(items) ? items.filter(Boolean) : [];
        safe.sort(sortBySetAtDesc);
        const slice = safe.slice(0, limit);
        if (!slice.length) return '(none)';

        return slice.map((entry) => {
          const phrase = censorPhrase(entry.phrase);
          const by = entry.setBy ? `<@${entry.setBy}>` : '(unknown)';
          const ts = entry.setAt ? Date.parse(entry.setAt) : NaN;
          const time = Number.isFinite(ts) ? `<t:${Math.floor(ts / 1000)}:R>` : '(unknown time)';
          return `• ${phrase} — ${by} ${time}`;
        }).join('\n');
      };

      const nopingStore = getGuildStore(noping, guildId);
      const nopingCount = nopingStore && typeof nopingStore === 'object' ? Object.keys(nopingStore).length : 0;
      const afkStore = getGuildStore(afk, guildId);
      const afkCount = afkStore && typeof afkStore === 'object' ? Object.keys(afkStore).length : 0;

      const ticketCount = tickets && typeof tickets === 'object'
        ? Object.values(tickets).filter(t => t && typeof t === 'object' && t.guildId === guildId).length
        : 0;

      const warningStore = getGuildStore(warnings, guildId);
      const warningTotal = warningStore ? countNestedArrays(warningStore) : 0;
      const warningUsers = warningStore && typeof warningStore === 'object' ? Object.keys(warningStore).length : 0;

      const noteStore = getGuildStore(notes, guildId);
      const noteTotal = noteStore ? countNestedArrays(noteStore) : 0;
      const noteUsers = noteStore && typeof noteStore === 'object' ? Object.keys(noteStore).length : 0;

      const pollStore = getGuildStore(polls, guildId);
      const pollsByMessageId = pollStore && pollStore.pollsByMessageId && typeof pollStore.pollsByMessageId === 'object'
        ? pollStore.pollsByMessageId
        : {};
      const anonPollsById = pollStore && pollStore.anonPollsById && typeof pollStore.anonPollsById === 'object'
        ? pollStore.anonPollsById
        : {};
      const pollCount = Object.keys(pollsByMessageId).length;
      const anonPollCount = Object.keys(anonPollsById).length;

      const testStore = getGuildStore(testSessions, guildId);
      const testActive = testStore && testStore.active && typeof testStore.active === 'object'
        ? testStore.active
        : null;
      const testHistoryCount = Array.isArray(testStore?.history) ? testStore.history.length : 0;

      const modStore = getGuildStore(moderations, guildId);
      const moderationCount = modStore && typeof modStore === 'object' ? Object.keys(modStore).length : 0;

      const embed = new EmbedBuilder()
        .setTitle('Current Configs')
        .setColor(0x002b2d31)
        .setDescription(`Snapshot generated <t:${nowUnix}:f>.`)
        .addFields(
          {
            name: 'Configured channels (channels.json)',
            value: truncate(linesForObj(channelsConfig), 1024) || '(none)',
            inline: false,
          },
          {
            name: 'Welcome (servers.json)',
            value: truncate(
              [
                `• enabled: **${welcomeEnabled ? 'yes' : 'no'}**`,
                `• channel: ${mentionChannel(welcomeChannelId)}`,
                `• template: ${welcomeTemplate}`,
              ].join('\n'),
              1024,
            ),
            inline: false,
          },
          {
            name: 'Automod (automod.json) — phrases censored',
            value: truncate(
              [
                `• blocked entries: **${blocked.length}**`,
                `• reverse entries: **${reverse.length}**`,
                '',
                '**Most recent blocked**',
                formatAutomodSample(blocked, 5),
                '',
                '**Most recent reverse**',
                formatAutomodSample(reverse, 5),
              ].join('\n'),
              1024,
            ),
            inline: false,
          },
          {
            name: 'Other stored state (data/*.json)',
            value: truncate(
              [
                `• AFK: **${afkCount}** user(s)`,
                `• NoPing: **${nopingCount}** rule(s)`,
                `• Tickets: **${ticketCount}**`,
                `• Warnings: **${warningTotal}** warning(s) across **${warningUsers}** user(s)`,
                `• Notes: **${noteTotal}** note(s) across **${noteUsers}** user(s)`,
                `• Polls: **${pollCount}**`,
                `• Anon Polls: **${anonPollCount}**`,
                `• Test Sessions: active **${testActive ? 'yes' : 'no'}**, history **${testHistoryCount}**`,
                `• Moderations: **${moderationCount}** record(s)`,
              ].join('\n'),
              1024,
            ),
            inline: false,
          },
        );

      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    const channel = interaction.options.getChannel('channel');

    if (!channel) {
      await interaction.reply({
        content: 'Please select a channel (or choose **Current Configs** to view stored settings).',
        ephemeral: true,
      });
      return;
    }

    if (!channel.isTextBased()) {
      await interaction.reply({
        content: 'Please select a text-based channel.',
        ephemeral: true,
      });
      return;
    }

    const store = loadChannels();
    store[kind] = channel.id;
    saveChannels(store);

    let label = kind;
    if (kind === 'command_logs') label = 'command log';
    if (kind === 'dm_forwarding') label = 'DM forwarding';

    await interaction.reply({
      content: `✅ Set ${label} channel to ${channel}.`,
      ephemeral: true,
    });
  },
};
