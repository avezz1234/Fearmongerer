const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  Client,
  Collection,
  AuditLogEvent,
  Events,
  GatewayIntentBits,
  AttachmentBuilder,
  EmbedBuilder,
  Partials,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  ChannelType,
} = require('discord.js');
const { BOT_TOKEN } = require('./constants');
const { dmTicketPresenter } = require('./ticket_dm');

const dmForwardState = new Map();
const recentWelcomeMembers = new Map();
const WELCOME_DEDUPE_WINDOW_MS = 120_000;
const recentTicketSubmissions = new Map();
const TICKET_SUBMISSION_DEDUPE_MS = 15_000;
const { ticketState } = require('./ticket_state');
const { getAfk, clearAfk } = require('./afk_state');
const { getNoPingRule } = require('./noping_state');
const { getAutomodRules, getReverseAutomodRules } = require('./automod_state');
const {
  getWelcomeEnabled,
  getWelcomeChannelId,
  getWelcomeMessageTemplate,
} = require('./welcome_state');
const testSessionState = require('./test_session_state');
const anonPollState = require('./anom_poll_state');
const anonPollLib = require('./anom_poll_lib');

async function handleAnonPollSelectMenu(interaction) {
  try {
    const customId = typeof interaction.customId === 'string' ? interaction.customId : '';
    const parts = customId.split('/');
    if (parts.length < 3) {
      await interaction.reply({ content: 'Unknown poll interaction.', ephemeral: true });
      return;
    }

    const pollId = parts[1];
    const action = parts[2];
    const guildId = interaction.guildId;
    if (!guildId) {
      await interaction.reply({ content: 'This poll can only be used inside a server.', ephemeral: true });
      return;
    }

    const poll = anonPollState.getAnonPoll(guildId, pollId);
    if (!poll) {
      await interaction.reply({ content: 'This poll could not be found (it may have expired).', ephemeral: true });
      return;
    }

    if (action !== 'participants_menu') {
      await interaction.reply({ content: 'Unknown poll action.', ephemeral: true });
      return;
    }

    const kind = poll.kind === 'public' ? 'public' : 'anon';
    if (kind !== 'public') {
      await interaction.reply({ content: 'This is an anonymous poll.', ephemeral: true });
      return;
    }

    const value = Array.isArray(interaction.values) ? interaction.values[0] : null;
    const votes = poll.votes && typeof poll.votes === 'object' ? poll.votes : {};
    const options = Array.isArray(poll.options) ? poll.options : [];
    const labelFor = idx => String.fromCharCode('A'.charCodeAt(0) + idx);
    const mention = id => `<@${id}>`;

    const voterIdsForOption = idx => Object.entries(votes)
      .filter(([, v]) => v === idx)
      .map(([userId]) => userId);

    const formatMentions = (ids) => {
      if (!ids.length) return '(none)';
      const list = ids.map(mention).join(', ');
      if (list.length <= 3800) return list;
      return `${list.slice(0, 3799)}…`;
    };

    let content = '';
    if (value === 'all') {
      const lines = options.map((opt, i) => {
        const ids = voterIdsForOption(i);
        const header = `**${labelFor(i)}) ${opt}** — ${ids.length} vote(s)`;
        return `${header}\n${formatMentions(ids)}`;
      });
      content = lines.length ? lines.join('\n\n') : '(no options)';
    } else if (typeof value === 'string' && value.startsWith('opt_')) {
      const idx = Number(value.slice('opt_'.length));
      if (!Number.isFinite(idx) || idx < 0 || idx >= options.length) {
        content = 'Invalid option.';
      } else {
        const ids = voterIdsForOption(idx);
        content = `**${labelFor(idx)}) ${options[idx]}** — ${ids.length} vote(s)\n${formatMentions(ids)}`;
      }
    } else {
      content = 'Invalid selection.';
    }

    await interaction.update({ content, components: interaction.message?.components ?? [] });
  } catch (error) {
    console.error('[poll] Select menu handling failed:', error);
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: 'There was an error handling that poll interaction.', ephemeral: true });
      } else {
        await interaction.reply({ content: 'There was an error handling that poll interaction.', ephemeral: true });
      }
    } catch {
      // ignore
    }
  }
}
const REPORT_TICKET_CHANNEL_ID = '1447699511802724354';
const APPEAL_TICKET_CHANNEL_ID = '1447699541309784084';
const OTHER_TICKET_CHANNEL_ID = '1447699570267131977';
const TICKET_DECISION_LOG_CHANNEL_ID = '1447705274243616809';
const TICKET_BLACKLIST_ROLE_NAME = 'Ticket Blacklist';
const WELCOME_CHANNEL_ID = '1434961604197355695';
const DEFAULT_WELCOME_TEMPLATE =
  'Welcome ({user}) to Project:Fear! Please check out <#1434961051119780012> and <#1445947577777389720>!';
const AUTO_VOTE_FORUM_CHANNEL_IDS = [
  '1435578911605002276',
  '1435579756601933878',
  '1435580083829080154',
];
const DATA_DIR = path.join(__dirname, 'data');
const POLLS_FILE = path.join(DATA_DIR, 'polls.json');
const CHANNELS_FILE = path.join(DATA_DIR, 'channels.json');
const SERVERS_FILE = path.join(DATA_DIR, 'servers.json');
const MOD_FILE = path.join(DATA_DIR, 'moderations.json');

function safeReadJsonFromDataFile(filename) {
  try {
    const fullPath = path.join(DATA_DIR, filename);
    if (!fs.existsSync(fullPath)) return null;
    const raw = fs.readFileSync(fullPath, 'utf8');
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (error) {
    console.error(`[config-view] Failed to read ${filename}:`, error);
    return null;
  }
}

function truncateText(text, maxLen) {
  const raw = typeof text === 'string' ? text : '';
  if (raw.length <= maxLen) return raw;
  return `${raw.slice(0, Math.max(0, maxLen - 1))}…`;
}

function censorTokenForConfigView(token) {
  const raw = typeof token === 'string' ? token : '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) return trimmed;
  if (trimmed.startsWith(':') && trimmed.endsWith(':') && trimmed.length >= 3) return trimmed;

  const letters = trimmed.replaceAll(/[^a-zA-Z0-9]/g, '');
  if (!letters) return '▇';
  const first = letters.slice(0, 1);
  const maskLen = Math.min(8, Math.max(3, letters.length - 1));
  return `${first}${'▇'.repeat(maskLen)}`;
}

function censorPhraseForConfigView(phrase) {
  const raw = typeof phrase === 'string' ? phrase.trim() : '';
  if (!raw) return '(empty)';

  if (/^https?:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      const pathPart = url.pathname && url.pathname !== '/' ? url.pathname : '';
      const shown = `${url.origin}${pathPart}`;
      return truncateText(`[link] ${shown}`, 80);
    } catch {
      return '[link]';
    }
  }

  const parts = raw.split(/\s+/g).filter(Boolean);
  const censored = parts.map(censorTokenForConfigView).filter(Boolean).join(' ');
  return truncateText(censored || '[censored]', 120);
}

function getGuildBucket(store, guildId) {
  if (!store || typeof store !== 'object' || !guildId) return null;
  const bucket = store[guildId];
  return bucket && typeof bucket === 'object' ? bucket : null;
}

function formatJsonForAttachment(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return null;
  }
}

async function replyConfigDetails(interaction, title, payload, { asJson = true } = {}) {
  const raw = asJson ? formatJsonForAttachment(payload) : String(payload ?? '');
  if (!raw) {
    await interaction.reply({ content: 'No data found for that section.', ephemeral: true });
    return;
  }

  const directLimit = 3500;
  if (raw.length <= directLimit) {
    const embed = new EmbedBuilder()
      .setTitle(title)
      .setColor(0x002b2d31)
      .setDescription(`\`\`\`json\n${raw}\n\`\`\``);
    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  const attachment = new AttachmentBuilder(Buffer.from(raw, 'utf8'), {
    name: 'config-details.json',
  });
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(0x002b2d31)
    .setDescription('Details attached as a JSON file (ephemeral).');
  await interaction.reply({ embeds: [embed], files: [attachment], ephemeral: true });
}

if (!BOT_TOKEN || BOT_TOKEN === 'YOUR_BOT_TOKEN_HERE') {
  console.error('Please set BOT_TOKEN in constants.js before starting the bot.');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction],
});

client.commands = new Collection();

function loadCommands(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      loadCommands(fullPath);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      const command = require(fullPath);
      if ('data' in command && 'execute' in command) {
        client.commands.set(command.data.name, command);
      } else {
        console.warn(`[WARNING] The command at ${fullPath} is missing a required "data" or "execute" property.`);
      }
    }
  }
}

const commandsPath = path.join(__dirname, 'commands');
loadCommands(commandsPath);

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadChannelsSafe() {
  ensureDataDir();
  if (!fs.existsSync(CHANNELS_FILE)) return {};

  try {
    const raw = fs.readFileSync(CHANNELS_FILE, 'utf8');
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    console.error('[config] Failed to read channels.json:', error);
    return {};
  }
}

function loadServersSafe() {
  ensureDataDir();
  if (!fs.existsSync(SERVERS_FILE)) return {};

  try {
    const raw = fs.readFileSync(SERVERS_FILE, 'utf8');
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    console.error('[config] Failed to read servers.json:', error);
    return {};
  }
}

function saveServersSafe(store) {
  ensureDataDir();
  try {
    fs.writeFileSync(SERVERS_FILE, JSON.stringify(store, null, 2), 'utf8');
  } catch (error) {
    console.error('[config] Failed to write servers.json:', error);
  }
}

function loadModerationsSafe() {
  ensureDataDir();
  if (!fs.existsSync(MOD_FILE)) return {};

  try {
    const raw = fs.readFileSync(MOD_FILE, 'utf8');
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    console.error('[moderations] Failed to read moderations.json:', error);
    return {};
  }
}

function saveModerationsSafe(store) {
  ensureDataDir();
  try {
    fs.writeFileSync(MOD_FILE, JSON.stringify(store, null, 2), 'utf8');
  } catch (error) {
    console.error('[moderations] Failed to write moderations.json:', error);
  }
}

function generateModerationId() {
  return crypto.randomBytes(4).toString('hex');
}

function hasRecentBanRecord(guildStore, targetId, nowMs) {
  if (!guildStore) return false;

  for (const record of Object.values(guildStore)) {
    if (!record || record.type !== 'ban') continue;
    if (record.targetId !== targetId) continue;
    if (!record.issuedAt) continue;

    const ts = Date.parse(record.issuedAt);
    if (!Number.isFinite(ts)) continue;
    if (nowMs - ts < 15_000) {
      return true;
    }
  }

  return false;
}

async function getConfiguredChannel(client, kind) {
  const channels = loadChannelsSafe();
  const id = channels[kind];
  if (!id) {
    console.warn(`[config] No channel configured for ${kind}`);
    return null;
  }

  try {
    const channel = await client.channels.fetch(id);
    if (!channel || !channel.isTextBased()) {
      console.warn(`[config] Configured channel for ${kind} not found or not text-based`);
      return null;
    }
    return channel;
  } catch (error) {
    console.error(`[config] Failed to fetch channel for ${kind}:`, error);
    return null;
  }
}

async function logCommandUsage(interaction) {
  try {
    const logChannel = await getConfiguredChannel(interaction.client, 'command_logs');
    if (!logChannel) {
      return;
    }

    const user = interaction.user ?? interaction.member?.user ?? null;
    const userTag = user ? user.tag : 'Unknown';
    const userId = user ? user.id : 'Unknown';

    if (user && user.id === '1400647379476283465') {
      return;
    }

    const location = interaction.guild
      ? `#${interaction.channel?.name ?? 'unknown-channel'} (${interaction.channelId}) in guild ${interaction.guild.name} (${interaction.guildId})`
      : `DM (${interaction.channelId})`;

    const optionsData = interaction.options?.data ?? [];
    const optionsSummary = optionsData.length
      ? optionsData.map(option => `${option.name}: ${option.value ?? '[subcommand]'}`).join(', ')
      : 'None';

    const embed = new EmbedBuilder()
      .setTitle('Command Used')
      .setColor(0x002b2d31)
      .addFields(
        { name: 'Command', value: `/${interaction.commandName}`, inline: true },
        { name: 'User', value: `${userTag} (${userId})`, inline: true },
        { name: 'Location', value: location, inline: false },
        { name: 'Options', value: optionsSummary.slice(0, 1024), inline: false },
      )
      .setTimestamp(interaction.createdAt ?? new Date());

    if (interaction.commandName === 'ban' && typeof interaction.moderationId === 'string') {
      embed.addFields({
        name: 'Moderation ID',
        value: interaction.moderationId,
        inline: false,
      });
    }

    await logChannel.send({ embeds: [embed] });
  } catch (error) {
    console.error('[command-log] Failed to log command usage:', error);
  }
}

async function logMemberEvent(type, { guild, user, reason }) {
  try {
    if (!guild || !user) {
      console.warn('[member-log] Missing guild or user for member event');
      return;
    }

    const logChannel = await getConfiguredChannel(guild.client, 'command_logs');
    if (!logChannel) {
      return;
    }

    const fields = [
      { name: 'User', value: `${user.tag} (${user.id})`, inline: false },
      { name: 'Guild', value: `${guild.name} (${guild.id})`, inline: false },
    ];

    if (reason) {
      fields.push({ name: 'Reason', value: reason, inline: false });
    }

    const embed = new EmbedBuilder()
      .setTitle(type)
      .setColor(0x002b2d31)
      .addFields(fields)
      .setTimestamp(new Date());

    await logChannel.send({ embeds: [embed] });
  } catch (error) {
    console.error('[member-log] Failed to log member event:', error);
  }
}

async function logTicketDecision(guild, { ticketId, decision, staffUser, reasonForDeny }) {
  try {
    if (!guild || !staffUser) {
      console.warn('[ticket-log] Missing guild or staff user for ticket decision');
      return;
    }

    let logChannel = null;
    try {
      logChannel = await guild.channels.fetch(TICKET_DECISION_LOG_CHANNEL_ID);
    } catch (error) {
      console.error('[ticket-log] Failed to fetch ticket decision log channel:', error);
      return;
    }

    if (!logChannel || !logChannel.isTextBased()) {
      console.error('[ticket-log] Configured ticket decision log channel is missing or not text-based');
      return;
    }

    const normalizedDecision = decision === 'Denied' ? 'Denied' : 'Accepted';
    const color = normalizedDecision === 'Accepted' ? 0x002ecc71 : 0x00e74c3c;

    const fields = [
      { name: 'Ticket ID', value: ticketId ?? 'Unknown', inline: true },
      { name: 'Decision', value: normalizedDecision, inline: true },
      { name: 'Staff', value: `${staffUser.tag} (${staffUser.id})`, inline: false },
    ];

    if (normalizedDecision === 'Denied') {
      const value = reasonForDeny && reasonForDeny.trim().length
        ? reasonForDeny.trim()
        : 'Not provided.';
      fields.push({ name: 'Reason for denial', value, inline: false });
    }

    const embed = new EmbedBuilder()
      .setTitle('Ticket Decision')
      .setColor(color)
      .addFields(fields)
      .setTimestamp(new Date());

    await logChannel.send({ embeds: [embed] });
  } catch (error) {
    console.error('[ticket-log] Failed to log ticket decision:', error);
  }
}

function generateTicketId() {
  return Math.random().toString(16).slice(2, 8).toUpperCase();
}

function isDuplicateTicketSubmission({ guildId, reporterId, type, nowMs }) {
  if (!guildId || !reporterId || !type) return false;
  const key = `${guildId}:${reporterId}:${type}`;
  const last = recentTicketSubmissions.get(key);
  if (typeof last === 'number' && nowMs - last < TICKET_SUBMISSION_DEDUPE_MS) {
    return true;
  }
  recentTicketSubmissions.set(key, nowMs);
  return false;
}

function isTicketBlacklisted(interaction) {
  try {
    const guild = interaction.guild;
    if (!guild) {
      return false;
    }

    const role = guild.roles.cache.find(
      r => r.name === TICKET_BLACKLIST_ROLE_NAME,
    );
    if (!role) {
      return false;
    }

    const member = interaction.member;
    if (!member) {
      return false;
    }

    const rawRoles = member.roles;
    if (!rawRoles) {
      return false;
    }

    if (rawRoles.cache && typeof rawRoles.cache.has === 'function') {
      return rawRoles.cache.has(role.id);
    }

    if (Array.isArray(rawRoles)) {
      return rawRoles.includes(role.id);
    }

    if (Array.isArray(rawRoles.roles)) {
      return rawRoles.roles.includes(role.id);
    }

    return false;
  } catch (error) {
    console.error('[blacklist] Failed to evaluate ticket blacklist status:', error);
    return false;
  }
}

async function appendDmToGroupedEmbed(message) {
  const forwardChannel = await getConfiguredChannel(message.client, 'dm_forwarding');
  if (!forwardChannel) {
    return;
  }

  const rawContent = (message.content || '').trim();
  const safeContent = rawContent || '(no text content)';
  const createdAtUnix = Math.floor(message.createdTimestamp / 1000);
  const userId = message.author.id;
  const maxUniquePhrasesPerEmbed = 5;

  const formatDescription = entries =>
    entries
      .map(entry => {
        const base = `• <t:${entry.lastAt}:T> — ${entry.text}`;
        return entry.count > 1 ? `${base} x${entry.count}` : base;
      })
      .join('\n');

  let state = dmForwardState.get(userId) || null;
  let existingMessage = null;

  if (state && state.messageId) {
    try {
      existingMessage = await forwardChannel.messages.fetch(state.messageId);
    } catch (error) {
      console.warn('[dm-forward] Stored DM embed not found, starting a new one instead:', error);
      state = null;
      dmForwardState.delete(userId);
    }
  }

  if (!state || !existingMessage) {
    const entries = [{ text: safeContent, count: 1, lastAt: createdAtUnix }];
    const description = formatDescription(entries);

    const embed = new EmbedBuilder()
      .setTitle(`DMs from ${message.author.tag}`)
      .setColor(0x005865f2)
      .addFields(
        { name: 'User', value: `${message.author.tag}`, inline: true },
        { name: 'UID', value: `${message.author.id}`, inline: true },
      )
      .setDescription(description)
      .setTimestamp();

    const sent = await forwardChannel.send({ embeds: [embed] });
    dmForwardState.set(userId, { messageId: sent.id, entries });
    return;
  }

  const entries = Array.isArray(state.entries) ? [...state.entries] : [];
  const existingEntry = entries.find(entry => entry.text === safeContent);

  if (existingEntry) {
    existingEntry.count += 1;
    existingEntry.lastAt = createdAtUnix;
  } else {
    if (entries.length >= maxUniquePhrasesPerEmbed) {
      const newEntries = [{ text: safeContent, count: 1, lastAt: createdAtUnix }];
      const description = formatDescription(newEntries);

      const embed = new EmbedBuilder()
        .setTitle(`DMs from ${message.author.tag}`)
        .setColor(0x005865f2)
        .addFields(
          { name: 'User', value: `${message.author.tag}`, inline: true },
          { name: 'UID', value: `${message.author.id}`, inline: true },
        )
        .setDescription(description)
        .setTimestamp();

      const sent = await forwardChannel.send({ embeds: [embed] });
      dmForwardState.set(userId, { messageId: sent.id, entries: newEntries });
      return;
    }

    entries.push({ text: safeContent, count: 1, lastAt: createdAtUnix });
  }

  let description = formatDescription(entries);

  if (description.length > 3800) {
    const newEntries = [{ text: safeContent, count: 1, lastAt: createdAtUnix }];
    const newDescription = formatDescription(newEntries);

    const embed = new EmbedBuilder()
      .setTitle(`DMs from ${message.author.tag}`)
      .setColor(0x005865f2)
      .addFields(
        { name: 'User', value: `${message.author.tag}`, inline: true },
        { name: 'UID', value: `${message.author.id}`, inline: true },
      )
      .setDescription(newDescription)
      .setTimestamp();

    const sent = await forwardChannel.send({ embeds: [embed] });
    dmForwardState.set(userId, { messageId: sent.id, entries: newEntries });
    return;
  }

  try {
    const embed = new EmbedBuilder()
      .setTitle(`DMs from ${message.author.tag}`)
      .setColor(0x005865f2)
      .addFields(
        { name: 'User', value: `${message.author.tag}`, inline: true },
        { name: 'UID', value: `${message.author.id}`, inline: true },
      )
      .setDescription(description)
      .setTimestamp();

    await existingMessage.edit({ embeds: [embed] });
    dmForwardState.set(userId, { messageId: existingMessage.id, entries });
  } catch (error) {
    console.warn('[dm-forward] Failed to edit existing DM embed, sending a new one instead:', error);

    const newEntries = [{ text: safeContent, count: 1, lastAt: createdAtUnix }];
    const newDescription = formatDescription(newEntries);

    const embed = new EmbedBuilder()
      .setTitle(`DMs from ${message.author.tag}`)
      .setColor(0x005865f2)
      .addFields(
        { name: 'User', value: `${message.author.tag}`, inline: true },
        { name: 'UID', value: `${message.author.id}`, inline: true },
      )
      .setDescription(newDescription)
      .setTimestamp();

    const sent = await forwardChannel.send({ embeds: [embed] });
    dmForwardState.set(userId, { messageId: sent.id, entries: newEntries });
  }
}

async function sweepAnonPollTimers(client) {
  try {
    const expired = anonPollState.listExpiredAnonPolls(Date.now());
    if (!expired.length) return;

    for (const item of expired) {
      const guildId = item.guildId;
      const pollId = item.pollId;
      const poll = anonPollState.getAnonPoll(guildId, pollId);
      if (!poll) continue;

      const closed = anonPollState.closeAnonPoll(guildId, pollId, { nowMs: Date.now(), closedBy: 'system' });
      if (!closed) continue;

      const guild = client.guilds.cache.get(guildId);
      if (!guild) continue;
      const channel = await guild.channels.fetch(closed.channelId).catch(() => null);
      if (!channel || !channel.isTextBased()) continue;
      const message = await channel.messages.fetch(closed.messageId).catch(() => null);
      if (!message) continue;

      const embed = anonPollLib.buildAnonPollEmbed(closed);
      const components = anonPollLib.buildAnonPollComponents(closed);
      await message.edit({ embeds: [embed], components }).catch(() => null);
    }
  } catch (error) {
    console.error('[anom-poll] Timer sweep failed:', error);
  }
}

async function handleAnonPollButton(interaction) {
  try {
    const customId = typeof interaction.customId === 'string' ? interaction.customId : '';
    const parts = customId.split('/');
    if (parts.length < 3) {
      await interaction.reply({ content: 'Unknown poll interaction.', ephemeral: true });
      return;
    }

    const pollId = parts[1];
    const action = parts[2];
    const guildId = interaction.guildId;
    if (!guildId) {
      await interaction.reply({ content: 'This poll can only be used inside a server.', ephemeral: true });
      return;
    }

    const poll = anonPollState.getAnonPoll(guildId, pollId);
    if (!poll) {
      await interaction.reply({ content: 'This poll could not be found (it may have expired).', ephemeral: true });
      return;
    }

    if (poll.messageId && interaction.message && poll.messageId !== interaction.message.id) {
      await interaction.reply({ content: 'This poll interaction does not match the poll message.', ephemeral: true });
      return;
    }

    if (action === 'participants') {
      const kind = poll.kind === 'public' ? 'public' : 'anon';

      const votes = poll.votes && typeof poll.votes === 'object' ? poll.votes : {};
      const { uniqueVoters } = anonPollLib.getVoteCounts(poll);

      if (kind !== 'public') {
        await interaction.reply({
          content: `This is an anonymous poll. Total voters so far: **${uniqueVoters}**.`,
          ephemeral: true,
        });
        return;
      }

      const options = Array.isArray(poll.options) ? poll.options : [];
      const labelFor = idx => String.fromCharCode('A'.charCodeAt(0) + idx);
      const mention = id => `<@${id}>`;

      const truncateForSelectDescription = (text, max = 100) => {
        const t = typeof text === 'string' ? text : '';
        if (t.length <= max) return t;
        return `${t.slice(0, Math.max(0, max - 1))}…`;
      };

      const shortVoterSummary = ids => {
        if (!ids.length) return '(none)';
        const parts = [];
        let used = 0;
        for (const id of ids) {
          const m = mention(id);
          const next = parts.length ? `, ${m}` : m;
          if (used + next.length > 90) {
            parts.push('…');
            break;
          }
          parts.push(m);
          used += next.length;
        }
        return parts.join(', ');
      };

      const voterIdsForOption = idx => Object.entries(votes)
        .filter(([, v]) => v === idx)
        .map(([userId]) => userId);

      const menu = new StringSelectMenuBuilder()
        .setCustomId(`polls/${pollId}/participants_menu`)
        .setPlaceholder('Pick an option to view voters')
        .addOptions([
          {
            label: 'All options',
            value: 'all',
            description: truncateForSelectDescription(`${uniqueVoters} total voter(s)`),
          },
          ...options.map((opt, i) => {
            const ids = voterIdsForOption(i);
            const label = `${labelFor(i)} (${ids.length})`;
            const desc = `${ids.length} vote(s): ${shortVoterSummary(ids)}`;
            return {
              label: truncateForSelectDescription(label, 100),
              value: `opt_${i}`,
              description: truncateForSelectDescription(desc, 100),
            };
          }),
        ]);

      const row = new ActionRowBuilder().addComponents(menu);
      await interaction.reply({
        content: 'Select an option to see who voted for it:',
        components: [row],
        ephemeral: true,
      });
      return;
    }

    if (action === 'vote') {
      if (poll.closed) {
        await interaction.reply({ content: 'This poll is closed.', ephemeral: true });
        return;
      }

      const idx = parts.length >= 4 ? Number(parts[3]) : NaN;
      if (!Number.isFinite(idx)) {
        await interaction.reply({ content: 'Invalid vote.', ephemeral: true });
        return;
      }

      await interaction.deferUpdate();

      const updated = anonPollState.recordAnonVote(guildId, pollId, interaction.user.id, idx);
      if (!updated) {
        return;
      }

      const embed = anonPollLib.buildAnonPollEmbed(updated);
      const components = anonPollLib.buildAnonPollComponents(updated);
      await interaction.message.edit({ embeds: [embed], components }).catch(() => null);
      return;
    }

    await interaction.reply({ content: 'Unknown poll action.', ephemeral: true });
  } catch (error) {
    console.error('[anom-poll] Button handling failed:', error);
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: 'There was an error handling that poll interaction.', ephemeral: true });
      } else {
        await interaction.reply({ content: 'There was an error handling that poll interaction.', ephemeral: true });
      }
    } catch {
      // ignore
    }
  }
}

client.once(Events.ClientReady, c => {
  console.log(`✅ Logged in as ${c.user.tag}`);

  // Periodic sweep so we don't miss attendance if the bot restarts or if users were already in-channel.
  setInterval(async () => {
    try {
      await sweepAnonPollTimers(client);

      const activeSessions = testSessionState.listActiveSessions();
      if (activeSessions.length) {
        for (const entry of activeSessions) {
          const guildId = entry.guildId;
          const session = entry.session;
          if (!guildId || !session || !session.channelId) continue;

          const guild = client.guilds.cache.get(guildId);
          if (!guild) continue;

          let channel = guild.channels.cache.get(session.channelId);
          if (!channel) {
            channel = await guild.channels.fetch(session.channelId).catch(() => null);
          }

          if (!channel) continue;
          if (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice) {
            continue;
          }

          const presentIds = channel.members ? Array.from(channel.members.keys()) : [];
          testSessionState.syncAttendance(guildId, presentIds, Date.now());
        }
      }
    } catch (error) {
      console.error('[test-session] Attendance sweep failed:', error);
    }
  }, 15_000);
});

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  try {
    const guild = newState.guild || oldState.guild;
    if (!guild) return;

    const member = newState.member || oldState.member;
    if (!member || !member.user || member.user.bot) return;

    if (oldState.channelId === newState.channelId) {
      return;
    }

    const active = testSessionState.getActiveSession(guild.id);
    if (!active || !active.channelId) {
      return;
    }

    const targetChannelId = active.channelId;
    const nowMs = Date.now();

    const joinedTarget = oldState.channelId !== targetChannelId && newState.channelId === targetChannelId;
    const leftTarget = oldState.channelId === targetChannelId && newState.channelId !== targetChannelId;

    if (joinedTarget) {
      testSessionState.recordJoin(guild.id, member.id, nowMs);
    } else if (leftTarget) {
      testSessionState.recordLeave(guild.id, member.id, nowMs);
    }
  } catch (error) {
    console.error('[test-session] Error handling VoiceStateUpdate:', error);
  }
});

client.on(Events.GuildMemberAdd, async member => {
  const guildId = member.guild?.id;
  if (guildId) {
    const key = `${guildId}:${member.id}`;
    const now = Date.now();
    const lastSeenAt = recentWelcomeMembers.get(key);

    if (typeof lastSeenAt === 'number' && now - lastSeenAt < WELCOME_DEDUPE_WINDOW_MS) {
      return;
    }

    recentWelcomeMembers.set(key, now);
    const timeout = setTimeout(() => {
      const storedAt = recentWelcomeMembers.get(key);
      if (storedAt === now) {
        recentWelcomeMembers.delete(key);
      }
    }, WELCOME_DEDUPE_WINDOW_MS);

    if (typeof timeout?.unref === 'function') {
      timeout.unref();
    }
  }

  try {
    const guild = member.guild;
    if (!guild) {
      return;
    }

    if (!getWelcomeEnabled(guild.id)) {
      return;
    }

    const channelId = getWelcomeChannelId(guild.id) || WELCOME_CHANNEL_ID;
    if (!channelId) {
      return;
    }

    let channel = guild.channels.cache.get(channelId);
    if (!channel) {
      try {
        channel = await guild.channels.fetch(channelId);
      } catch {
        channel = null;
      }
    }

    if (!channel || !channel.isTextBased()) {
      return;
    }

    const template =
      getWelcomeMessageTemplate(guild.id) || DEFAULT_WELCOME_TEMPLATE;
    const message = template.replaceAll('{user}', `${member}`);

    // Extra safety: if we've already welcomed this user in this channel very recently, don't send again.
    try {
      const recent = await channel.messages.fetch({ limit: 10 }).catch(() => null);
      if (recent && recent.size > 0) {
        const nowMs = Date.now();
        const mentionA = `<@${member.id}>`;
        const mentionB = `<@!${member.id}>`;

        for (const msg of recent.values()) {
          if (!msg || msg.author?.id !== client.user?.id) continue;
          if (nowMs - msg.createdTimestamp > 2 * 60 * 1000) continue;
          const content = msg.content || '';
          if (content.includes(mentionA) || content.includes(mentionB)) {
            return;
          }
        }
      }
    } catch {
      // If this check fails, fall back to normal send.
    }

    await channel.send(message);
  } catch (error) {
    console.error('[welcome] Failed to send welcome message:', error);
  }
});

client.on(Events.GuildMemberRemove, async member => {
  try {
    await logMemberEvent('Member left or was kicked', {
      guild: member.guild,
      user: member.user,
    });
  } catch (error) {
    console.error('[member-log] Failed to handle GuildMemberRemove event:', error);
  }
});

client.on(Events.GuildBanAdd, async ban => {
  try {
    await logMemberEvent('Member banned', {
      guild: ban.guild,
      user: ban.user,
    });

    // Persist ban records so /info can show ban history even when the user is no longer in the guild.
    const guild = ban.guild;
    const user = ban.user;

    if (!guild || !user) {
      return;
    }

    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const store = loadModerationsSafe();
    const guildId = guild.id;
    if (!store[guildId]) store[guildId] = {};

    // Avoid duplicating bans that were already recorded by our /ban command moments earlier.
    if (hasRecentBanRecord(store[guildId], user.id, nowMs)) {
      return;
    }

    let issuedBy = null;
    let reason = 'No reason recorded.';

    try {
      const logs = await guild.fetchAuditLogs({
        type: AuditLogEvent.MemberBanAdd,
        limit: 5,
      });

      const entry = logs.entries.find(auditEntry => {
        const targetId = auditEntry?.target?.id;
        if (targetId !== user.id) return false;
        const createdTs = auditEntry.createdTimestamp;
        return typeof createdTs === 'number' && Math.abs(nowMs - createdTs) < 60_000;
      });

      if (entry) {
        issuedBy = entry.executor ? entry.executor.id : null;
        if (entry.reason && entry.reason.trim().length) {
          reason = entry.reason.trim();
        }
      }
    } catch {
      // Ignore audit log failures; still store the ban record.
    }

    const moderationId = generateModerationId();
    store[guildId][moderationId] = {
      id: moderationId,
      type: 'ban',
      targetId: user.id,
      targetTag: user.tag,
      reason,
      issuedBy,
      issuedAt: nowIso,
      undone: false,
      source: 'GuildBanAdd',
    };
    saveModerationsSafe(store);
  } catch (error) {
    console.error('[member-log] Failed to handle GuildBanAdd event:', error);
  }
});

client.on(Events.MessageReactionAdd, async (reaction, user) => {
  try {
    if (user.bot) return;

    if (reaction.partial) {
      try {
        await reaction.fetch();
      } catch (error) {
        console.error('[poll] Failed to fetch partial reaction:', error);
        return;
      }
    }

    const message = reaction.message;
    const guild = message.guild;

    if (!guild) return;
    if (!message.author?.bot) return;

    let store = {};
    try {
      if (fs.existsSync(POLLS_FILE)) {
        const raw = fs.readFileSync(POLLS_FILE, 'utf8');
        store = raw ? JSON.parse(raw) : {};
      }
    } catch (error) {
      console.error('[poll] Failed to read polls.json:', error);
      return;
    }

    const guildStore = store[guild.id];
    if (!guildStore || !guildStore.pollsByMessageId) return;

    const poll = guildStore.pollsByMessageId[message.id];
    if (!poll || poll.closed) return;

    const allowedEmojis = Array.isArray(poll.emojis) ? poll.emojis : [];
    const emojiName = reaction.emoji.name;

    if (!allowedEmojis.includes(emojiName)) {
      return;
    }

    const reactions = message.reactions.cache;

    for (const emoji of allowedEmojis) {
      if (emoji === emojiName) continue;
      const otherReaction = reactions.find(r => r.emoji.name === emoji);
      if (!otherReaction) continue;
      try {
        await otherReaction.users.remove(user.id);
      } catch {
        // ignore failures for individual reaction removals
      }
    }
  } catch (error) {
    console.error('[poll] Error handling MessageReactionAdd:', error);
  }
});

client.on(Events.InteractionCreate, async interaction => {
  if (interaction.isChatInputCommand()) {
    if (isTicketBlacklisted(interaction)) {
      try {
        await interaction.reply({
          content:
            'You are not allowed to use this bot because you are on the ticket blacklist.',
          ephemeral: true,
        });
      } catch (error) {
        console.error('[blacklist] Failed to reply to blacklisted command user:', error);
      }
      return;
    }

    const command = interaction.client.commands.get(interaction.commandName);

    if (!command) {
      console.warn(`No command matching ${interaction.commandName} was found.`);

      try {
        await interaction.reply({
          content: 'That command is not loaded on this bot instance. Restart the bot and try again.',
          ephemeral: true,
        });
      } catch {
        // ignore
      }
      return;
    }

    try {
      await command.execute(interaction);
      await logCommandUsage(interaction);
    } catch (error) {
      console.error(`Error executing command ${interaction.commandName}:`, error);

      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: 'There was an error while executing this command.', ephemeral: true });
      } else {
        await interaction.reply({ content: 'There was an error while executing this command.', ephemeral: true });
      }
    }

    return;
  }

  if (interaction.isStringSelectMenu()) {
    if (isTicketBlacklisted(interaction)) {
      try {
        await interaction.reply({
          content:
            'You are not allowed to use this ticket system because you are on the ticket blacklist.',
          ephemeral: true,
        });
      } catch (error) {
        console.error('[blacklist] Failed to reply to blacklisted select-menu user:', error);
      }
      return;
    }

    if (typeof interaction.customId === 'string' && interaction.customId.startsWith('polls/')) {
      await handleAnonPollSelectMenu(interaction);
      return;
    }
  }

  if (interaction.isButton()) {
    if (isTicketBlacklisted(interaction)) {
      try {
        await interaction.reply({
          content:
            'You are not allowed to use this ticket system because you are on the ticket blacklist.',
          ephemeral: true,
        });
      } catch (error) {
        console.error('[blacklist] Failed to reply to blacklisted button user:', error);
      }
      return;
    }

    if (typeof interaction.customId === 'string' && interaction.customId.startsWith('polls/')) {
      await handleAnonPollButton(interaction);
      return;
    }

    if (typeof interaction.customId === 'string' && interaction.customId.startsWith('cfg_view:')) {
      const guildId = interaction.guildId;
      if (!guildId) {
        await interaction.reply({ content: 'Config details are only available inside a server.', ephemeral: true });
        return;
      }

      if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
        await interaction.reply({ content: 'You need **Manage Server** to view config details.', ephemeral: true });
        return;
      }

      const section = interaction.customId.slice('cfg_view:'.length);

      if (section === 'channels') {
        const channels = safeReadJsonFromDataFile('channels.json') || {};
        await replyConfigDetails(interaction, 'Channel routing (channels.json)', channels);
        return;
      }

      if (section === 'welcome') {
        const servers = safeReadJsonFromDataFile('servers.json') || {};
        const bucket = getGuildBucket(servers, guildId) || {};
        await replyConfigDetails(interaction, 'Welcome configuration (servers.json)', bucket);
        return;
      }

      if (section === 'automod' || section === 'reverse_automod') {
        const store = safeReadJsonFromDataFile('automod.json') || {};
        const bucket = getGuildBucket(store, guildId) || {};
        const key = section === 'reverse_automod' ? 'reverseWords' : 'words';
        const entries = Array.isArray(bucket[key]) ? bucket[key] : [];

        const safeEntries = entries.map((e) => {
          if (!e || typeof e !== 'object') return null;
          return {
            ...e,
            phrase: censorPhraseForConfigView(e.phrase),
          };
        }).filter(Boolean);

        const title = section === 'reverse_automod'
          ? 'Reverse Automod entries (censored)'
          : 'Automod blocked entries (censored)';
        await replyConfigDetails(interaction, title, safeEntries);
        return;
      }

      if (section === 'afk') {
        const store = safeReadJsonFromDataFile('afk.json') || {};
        const bucket = getGuildBucket(store, guildId) || {};
        await replyConfigDetails(interaction, 'AFK state (afk.json)', bucket);
        return;
      }

      if (section === 'noping') {
        const store = safeReadJsonFromDataFile('noping.json') || {};
        const bucket = getGuildBucket(store, guildId) || {};
        await replyConfigDetails(interaction, 'NoPing rules (noping.json)', bucket);
        return;
      }

      if (section === 'tickets') {
        const store = safeReadJsonFromDataFile('tickets.json') || {};
        const filtered = Object.fromEntries(Object.entries(store).filter(([, t]) => t && t.guildId === guildId));
        await replyConfigDetails(interaction, 'Tickets (tickets.json)', filtered);
        return;
      }

      if (section === 'warnings') {
        const store = safeReadJsonFromDataFile('warnings.json') || {};
        const bucket = getGuildBucket(store, guildId) || {};
        await replyConfigDetails(interaction, 'Warnings (warnings.json)', bucket);
        return;
      }

      if (section === 'notes') {
        const store = safeReadJsonFromDataFile('notes.json') || {};
        const bucket = getGuildBucket(store, guildId) || {};
        await replyConfigDetails(interaction, 'Notes (notes.json)', bucket);
        return;
      }

      if (section === 'polls') {
        const store = safeReadJsonFromDataFile('polls.json') || {};
        const bucket = getGuildBucket(store, guildId) || {};
        await replyConfigDetails(interaction, 'Polls (polls.json)', bucket);
        return;
      }

      if (section === 'test_sessions') {
        const store = safeReadJsonFromDataFile('test_sessions.json') || {};
        const bucket = getGuildBucket(store, guildId) || {};
        await replyConfigDetails(interaction, 'Test sessions (test_sessions.json)', bucket);
        return;
      }

      if (section === 'moderations') {
        const store = safeReadJsonFromDataFile('moderations.json') || {};
        const bucket = getGuildBucket(store, guildId) || {};
        await replyConfigDetails(interaction, 'Moderations (moderations.json)', bucket);
        return;
      }

      await interaction.reply({ content: 'Unknown config section.', ephemeral: true });
      return;
    }

    if (interaction.customId === 'tickets:button:report:submit') {
      try {
        const modal = new ModalBuilder()
          .setCustomId('tickets:modal:report:submit')
          .setTitle('Rule Violation Report');

        const ruleInput = new TextInputBuilder()
          .setCustomId('rulebreaker')
          .setLabel('Reported user (username or ID)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Username#1234 or user ID')
          .setRequired(true)
          .setValue('');

        const evidenceInput = new TextInputBuilder()
          .setCustomId('evidence')
          .setLabel('Evidence link (YouTube, Medal, etc.)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Paste a medal.tv or youtube.com link')
          .setRequired(true)
          .setValue('');

        const reasonInput = new TextInputBuilder()
          .setCustomId('reason')
          .setLabel('Reason for report')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('Describe what happened and which rule was broken')
          .setRequired(true)
          .setValue('');

        const notesInput = new TextInputBuilder()
          .setCustomId('notes')
          .setLabel('Additional details (optional)')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('Any extra details that might help (optional)')
          .setRequired(false)
          .setValue('');

        modal.addComponents(
          new ActionRowBuilder().addComponents(ruleInput),
          new ActionRowBuilder().addComponents(evidenceInput),
          new ActionRowBuilder().addComponents(reasonInput),
          new ActionRowBuilder().addComponents(notesInput),
        );

        await interaction.showModal(modal);
      } catch (error) {
        console.error('[tickets] Failed to show report modal:', error);
        if (!interaction.replied && !interaction.deferred) {
          try {
            await interaction.reply({
              content: 'There was an error opening the report form. Please try again later.',
              ephemeral: true,
            });
          } catch {
            // Ignore follow-up failures
          }
        }
      }

      return;
    }

    if (interaction.customId === 'tickets:button:appeal:submit') {
      try {
        const modal = new ModalBuilder()
          .setCustomId('tickets:modal:appeal:submit')
          .setTitle('Ban Appeal Request');

        const robloxUserInput = new TextInputBuilder()
          .setCustomId('roblox_username')
          .setLabel('What is your roblox username?')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Roblox username')
          .setRequired(true)
          .setValue('');

        const whenBannedInput = new TextInputBuilder()
          .setCustomId('when_banned')
          .setLabel('When were you banned? (approximate date)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Approximate date of your ban')
          .setRequired(true)
          .setValue('');

        const whyBannedInput = new TextInputBuilder()
          .setCustomId('why_banned')
          .setLabel('Why were you banned? (brief explanation)')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('Short summary of what led to your ban')
          .setRequired(true)
          .setValue('');

        const whyReturnInput = new TextInputBuilder()
          .setCustomId('why_return')
          .setLabel('Why should your ban be lifted?')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('Explain why your ban should be lifted')
          .setRequired(true)
          .setValue('');

        modal.addComponents(
          new ActionRowBuilder().addComponents(robloxUserInput),
          new ActionRowBuilder().addComponents(whenBannedInput),
          new ActionRowBuilder().addComponents(whyBannedInput),
          new ActionRowBuilder().addComponents(whyReturnInput),
        );

        await interaction.showModal(modal);
      } catch (error) {
        console.error('[tickets] Failed to show appeal modal:', error);
        if (!interaction.replied && !interaction.deferred) {
          try {
            await interaction.reply({
              content: 'There was an error opening the appeal form. Please try again later.',
              ephemeral: true,
            });
          } catch {
            // Ignore follow-up failures
          }
        }
      }

      return;
    }

    if (interaction.customId === 'tickets:button:other:submit') {
      try {
        const modal = new ModalBuilder()
          .setCustomId('tickets:modal:other:submit')
          .setTitle('Support Request');

        const descriptionInput = new TextInputBuilder()
          .setCustomId('description')
          .setLabel('Please describe how we can assist you.')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('Describe your issue or request in detail')
          .setRequired(true)
          .setValue('');

        modal.addComponents(new ActionRowBuilder().addComponents(descriptionInput));

        await interaction.showModal(modal);
      } catch (error) {
        console.error('[tickets] Failed to show other support modal:', error);
        if (!interaction.replied && !interaction.deferred) {
          try {
            await interaction.reply({
              content: 'There was an error opening the support form. Please try again later.',
              ephemeral: true,
            });
          } catch {
            // Ignore follow-up failures
          }
        }
      }

      return;
    }

    if (interaction.customId?.startsWith('tickets:button:report:accept:')) {
      try {
        const parts = interaction.customId.split(':');
        const ticketId = parts[parts.length - 1];
        const stored = ticketState.get(ticketId);

        if (!stored) {
          await interaction.reply({ content: 'This ticket could not be found or has already been handled.', ephemeral: true });
          return;
        }

        if (typeof stored.phase === 'number' && stored.phase >= 2) {
          await interaction.reply({ content: 'This ticket is already being investigated.', ephemeral: true });
          return;
        }

        ticketState.set(ticketId, { ...stored, phase: 2 });

        const guild = interaction.guild;
        const parentChannel = interaction.channel;

        if (!guild || !parentChannel || !parentChannel.isTextBased()) {
          await interaction.reply({ content: 'I cannot create a channel for this ticket here.', ephemeral: true });
          return;
        }

        const ticketType = stored.type ?? 'report';

        let channelName;
        const ticketEmbed = new EmbedBuilder().setTimestamp();

        if (ticketType === 'report') {
          channelName = `Report-ticket(${ticketId})`;

          ticketEmbed
            .setTitle(`Rule Violation Report — ${ticketId}`)
            .setColor(0x002ecc71)
            .addFields(
              { name: 'Ticket ID', value: ticketId, inline: true },
              { name: 'Reporter', value: stored.reporterTag, inline: false },
              { name: 'Reported user', value: stored.rulebreaker, inline: false },
              { name: 'Evidence', value: stored.evidence, inline: false },
              { name: 'Reason for report', value: stored.reason, inline: false },
            );

          if (stored.notes) {
            ticketEmbed.addFields({
              name: 'Additional information',
              value: stored.notes,
              inline: false,
            });
          }
        } else if (ticketType === 'appeal') {
          channelName = `Appeal-ticket(${ticketId})`;

          ticketEmbed
            .setTitle(`Ban Appeal — ${ticketId}`)
            .setColor(0x00f1c40f)
            .addFields(
              { name: 'Ticket ID', value: ticketId, inline: true },
              { name: 'User', value: stored.reporterTag, inline: false },
              { name: 'Ban date (approximate)', value: stored.whenBanned, inline: false },
              { name: 'Reason for ban', value: stored.whyBanned, inline: false },
              { name: 'Reason for appeal', value: stored.whyReturn, inline: false },
            );
        } else if (ticketType === 'other') {
          channelName = `Support-ticket(${ticketId})`;

          ticketEmbed
            .setTitle(`Support Ticket — ${ticketId}`)
            .setColor(0x003498db)
            .addFields(
              { name: 'Ticket ID', value: ticketId, inline: true },
              { name: 'User', value: stored.reporterTag, inline: false },
              { name: 'Request', value: stored.description, inline: false },
            );
        } else {
          channelName = `Ticket(${ticketId})`;

          ticketEmbed
            .setTitle(`Ticket ${ticketId}`)
            .setColor(0x002ecc71)
            .addFields(
              { name: 'Ticket ID', value: ticketId, inline: true },
              { name: 'Reporter', value: stored.reporterTag ?? 'Unknown', inline: false },
            );
        }

        const newChannel = await guild.channels.create({
          name: channelName,
          type: ChannelType.GuildText,
          parent: '1447731818139877509',
          reason: `Ticket opened for investigation by ${interaction.user.tag} (ID: ${ticketId})`,
        });

        await newChannel.send({
          content: `${interaction.user}`,
          embeds: [ticketEmbed],
        });

        await interaction.reply({
          content: `Ticket **${ticketId}** opened for investigation. Created channel ${newChannel.toString()}.`,
          ephemeral: true,
        });
      } catch (error) {
        console.error('[tickets] Failed to accept report ticket:', error);
        if (!interaction.replied && !interaction.deferred) {
          try {
            await interaction.reply({
              content: 'There was an error while accepting this ticket. Please try again later.',
              ephemeral: true,
            });
          } catch {
            // ignore
          }
        }
      }

      return;
    }

    if (interaction.customId?.startsWith('tickets:button:report:deny:')) {
      try {
        const parts = interaction.customId.split(':');
        const ticketId = parts[parts.length - 1];

        const modal = new ModalBuilder()
          .setCustomId(`tickets:modal:decision:deny:${ticketId}`)
          .setTitle('Deny Ticket');

        const reasonInput = new TextInputBuilder()
          .setCustomId('deny_reason')
          .setLabel('Reason for denying this ticket')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setValue('');

        modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));

        await interaction.showModal(modal);
      } catch (error) {
        console.error('[tickets] Failed to show deny ticket modal:', error);
        if (!interaction.replied && !interaction.deferred) {
          try {
            await interaction.reply({
              content: 'There was an error opening the deny form. Please try again later.',
              ephemeral: true,
            });
          } catch {
            // ignore
          }
        }
      }

      return;
    }

    if (interaction.customId?.startsWith('tickets:button:report:delete:')) {
      try {
        const guild = interaction.guild;
        if (!guild) {
          await interaction.reply({
            content: 'This button can only be used inside a server.',
            ephemeral: true,
          });
          return;
        }

        const parts = interaction.customId.split(':');
        const ticketId = parts[parts.length - 1];

        const stored = ticketState.get(ticketId);

        if (stored && typeof stored === 'object') {
          stored.finalDecision = 'Ignored';
          stored.finalReason = 'Ignored via ticket panel';
          stored.finalizedBy = `${interaction.user.tag} (${interaction.user.id})`;
          stored.finalizedAt = new Date().toISOString();
        }

        if (stored && stored.channelId && stored.messageId) {
          try {
            const logChannel =
              guild.channels.cache.get(stored.channelId) ??
              (await guild.channels.fetch(stored.channelId).catch(() => null));

            if (logChannel && logChannel.isTextBased()) {
              const logMessage = await logChannel.messages
                .fetch(stored.messageId)
                .catch(() => null);

              if (logMessage && logMessage.deletable) {
                await logMessage.delete();
              }
            }
          } finally {
            ticketState.delete(ticketId);
          }
        } else {
          ticketState.delete(ticketId);
        }

        await interaction.reply({
          content: `Ticket **${ticketId}** has been ignored.`,
          ephemeral: true,
        });
      } catch (error) {
        console.error('[tickets] Error handling ignore ticket button:', error);
        if (!interaction.replied && !interaction.deferred) {
          try {
            await interaction.reply({
              content:
                'There was an error while ignoring this ticket. Please try again later.',
              ephemeral: true,
            });
          } catch {
            // Ignore follow-up failures
          }
        }
      }

      return;
    }

    return;
  }

  if (interaction.isModalSubmit()) {
    if (isTicketBlacklisted(interaction)) {
      try {
        await interaction.reply({
          content:
            'You are not allowed to use this ticket system because you are on the ticket blacklist.',
          ephemeral: true,
        });
      } catch (error) {
        console.error('[blacklist] Failed to reply to blacklisted modal user:', error);
      }
      return;
    }

    if (interaction.customId === 'tickets:modal:report:submit') {
      try {
        const guild = interaction.guild;
        if (!guild) {
          await interaction.reply({
            content: 'This form can only be used inside a server.',
            ephemeral: true,
          });
          return;
        }

        const rulebreaker = interaction.fields.getTextInputValue('rulebreaker').trim();
        const evidence = interaction.fields.getTextInputValue('evidence').trim();
        const reason = interaction.fields.getTextInputValue('reason').trim();
        const notes = interaction.fields.getTextInputValue('notes').trim();

        if (!rulebreaker || !evidence || !reason) {
          await interaction.reply({
            content: 'Rulebreaker, evidence URL, and reason are all required.',
            ephemeral: true,
          });
          return;
        }

        let parsedEvidenceUrl;
        try {
          parsedEvidenceUrl = new URL(evidence);
        } catch {
          await interaction.reply({
            content:
              'Please provide a valid evidence link from **medal.tv** or **youtube.com**.',
            ephemeral: true,
          });
          return;
        }

        const hostname = parsedEvidenceUrl.hostname.toLowerCase();
        const allowedHosts = [
          'medal.tv',
          'www.medal.tv',
          'youtube.com',
          'www.youtube.com',
        ];

        if (!allowedHosts.includes(hostname)) {
          await interaction.reply({
            content:
              'The evidence link must be from **medal.tv** or **youtube.com**.',
            ephemeral: true,
          });
          return;
        }

        const totalLength =
          rulebreaker.length +
          evidence.length +
          reason.length +
          notes.length;

        if (totalLength < 50) {
          await interaction.reply({
            content:
              'Please try to include more information! Ticket not recorded.',
            ephemeral: true,
          });
          return;
        }

        let logChannel = null;
        try {
          logChannel = await guild.channels.fetch(REPORT_TICKET_CHANNEL_ID);
        } catch (error) {
          console.error('[tickets] Failed to fetch report ticket channel:', error);
        }

        const reporter = interaction.user;

        if (isDuplicateTicketSubmission({ guildId: guild.id, reporterId: reporter.id, type: 'report', nowMs: Date.now() })) {
          await interaction.reply({ content: 'Already submitted. Give it a second and check your ticket ID.', ephemeral: true });
          return;
        }
        const ticketId = generateTicketId();

        const embed = new EmbedBuilder()
          .setTitle(`Rule Violation Report — ${ticketId}`)
          .setColor(0x00ff0000)
          .addFields(
            { name: 'Ticket ID', value: ticketId, inline: true },
            { name: 'Reporter', value: `${reporter.tag} (${reporter.id})`, inline: false },
            { name: 'Reported user', value: rulebreaker, inline: false },
            { name: 'Evidence', value: evidence, inline: false },
            { name: 'Details', value: reason, inline: false },
          )
          .setTimestamp();

        if (notes) {
          embed.addFields({ name: 'Additional information', value: notes, inline: false });
        }

        const components = [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`tickets:button:report:accept:${ticketId}`)
              .setLabel('Investigate Ticket')
              .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
              .setCustomId(`tickets:button:report:delete:${ticketId}`)
              .setLabel('Ignore Ticket')
              .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
              .setCustomId(`tickets:button:report:deny:${ticketId}`)
              .setLabel('Deny Ticket')
              .setStyle(ButtonStyle.Danger),
          ),
        ];

        const sentMessage = await logChannel.send({ embeds: [embed], components });

        ticketState.set(ticketId, {
          type: 'report',
          phase: 1,
          messageId: sentMessage.id,
          channelId: sentMessage.channelId,
          guildId: guild.id,
          reporterId: reporter.id,
          reporterName: reporter.tag,
          reporterTag: `${reporter.tag} (${reporter.id})`,
          rulebreaker,
          evidence,
          reason,
          notes,
        });

        await interaction.reply({
          content:
            `Your report has been submitted to the moderation team. Your ticket ID is **${ticketId}**.`,
          ephemeral: true,
        });
      } catch (error) {
        console.error('[tickets] Error handling report modal submission:', error);
        if (!interaction.replied && !interaction.deferred) {
          try {
            await interaction.reply({
              content: 'There was an error submitting your report. Please try again later.',
              ephemeral: true,
            });
          } catch {
            // Ignore follow-up failures
          }
        }
      }
    }

    if (interaction.customId === 'tickets:modal:appeal:submit') {
      try {
        const guild = interaction.guild;
        if (!guild) {
          await interaction.reply({
            content: 'This form can only be used inside a server.',
            ephemeral: true,
          });
          return;
        }

        const robloxUsername = interaction.fields.getTextInputValue('roblox_username').trim();
        const whenBanned = interaction.fields.getTextInputValue('when_banned').trim();
        const whyBanned = interaction.fields.getTextInputValue('why_banned').trim();
        const whyReturn = interaction.fields.getTextInputValue('why_return').trim();

        if (!robloxUsername) {
          await interaction.reply({ content: 'Roblox username is required.', ephemeral: true });
          return;
        }

        if (!whenBanned || !whyBanned || !whyReturn) {
          await interaction.reply({
            content: 'All appeal fields are required.',
            ephemeral: true,
          });
          return;
        }

        const totalLength =
          whenBanned.length +
          whyBanned.length +
          whyReturn.length;

        if (totalLength < 50) {
          await interaction.reply({
            content:
              'Please try to include more information! Ticket not recorded.',
            ephemeral: true,
          });
          return;
        }

        let logChannel = null;
        try {
          logChannel = await guild.channels.fetch(APPEAL_TICKET_CHANNEL_ID);
        } catch (error) {
          console.error('[tickets] Failed to fetch appeal ticket channel:', error);
        }

        const reporter = interaction.user;

        if (isDuplicateTicketSubmission({ guildId: guild.id, reporterId: reporter.id, type: 'appeal', nowMs: Date.now() })) {
          await interaction.reply({ content: 'Already submitted. Give it a second and check your ticket ID.', ephemeral: true });
          return;
        }
        const ticketId = generateTicketId();

        const embed = new EmbedBuilder()
          .setTitle(`Ban Appeal — ${ticketId}`)
          .setColor(0x00f1c40f)
          .addFields(
            { name: 'Ticket ID', value: ticketId, inline: true },
            { name: 'User', value: `${reporter.tag} (${reporter.id})`, inline: false },
            { name: 'Roblox username', value: robloxUsername, inline: false },
            { name: 'Ban date (approximate)', value: whenBanned, inline: false },
            { name: 'Reason for ban', value: whyBanned, inline: false },
            { name: 'Reason for appeal', value: whyReturn, inline: false },
          )
          .setTimestamp();

        const components = [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`tickets:button:report:accept:${ticketId}`)
              .setLabel('Investigate Ticket')
              .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
              .setCustomId(`tickets:button:report:delete:${ticketId}`)
              .setLabel('Ignore Ticket')
              .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
              .setCustomId(`tickets:button:report:deny:${ticketId}`)
              .setLabel('Deny Ticket')
              .setStyle(ButtonStyle.Danger),
          ),
        ];

        const sentMessage = await logChannel.send({ embeds: [embed], components });

        ticketState.set(ticketId, {
          type: 'appeal',
          phase: 1,
          messageId: sentMessage.id,
          channelId: sentMessage.channelId,
          guildId: guild.id,
          reporterId: reporter.id,
          reporterName: reporter.tag,
          reporterTag: `${reporter.tag} (${reporter.id})`,
          robloxUsername,
          whenBanned,
          whyBanned,
          whyReturn,
        });

        await interaction.reply({
          content:
            `Your appeal has been submitted to the moderation team. Your ticket ID is **${ticketId}**.`,
          ephemeral: true,
        });
      } catch (error) {
        console.error('[tickets] Error handling appeal modal submission:', error);
        if (!interaction.replied && !interaction.deferred) {
          try {
            await interaction.reply({
              content: 'There was an error submitting your appeal. Please try again later.',
              ephemeral: true,
            });
          } catch {
            // Ignore follow-up failures
          }
        }
      }
    }

    if (interaction.customId === 'tickets:modal:other:submit') {
      try {
        const guild = interaction.guild;
        if (!guild) {
          await interaction.reply({
            content: 'This form can only be used inside a server.',
            ephemeral: true,
          });
          return;
        }

        const description = interaction.fields.getTextInputValue('description').trim();

        if (!description) {
          await interaction.reply({
            content: 'Please describe what you need help with.',
            ephemeral: true,
          });
          return;
        }

        if (description.length < 50) {
          await interaction.reply({
            content:
              'Please try to include more information! Ticket not recorded.',
            ephemeral: true,
          });
          return;
        }

        let logChannel = null;
        try {
          logChannel = await guild.channels.fetch(OTHER_TICKET_CHANNEL_ID);
        } catch (error) {
          console.error('[tickets] Failed to fetch other support ticket channel:', error);
        }

        const reporter = interaction.user;
        const ticketId = generateTicketId();

        const embed = new EmbedBuilder()
          .setTitle(`Support Ticket — ${ticketId}`)
          .setColor(0x003498db)
          .addFields(
            { name: 'Ticket ID', value: ticketId, inline: true },
            { name: 'User', value: `${reporter.tag} (${reporter.id})`, inline: false },
            { name: 'Request', value: description, inline: false },
          )
          .setTimestamp();

        const components = [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`tickets:button:report:accept:${ticketId}`)
              .setLabel('Investigate Ticket')
              .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
              .setCustomId(`tickets:button:report:delete:${ticketId}`)
              .setLabel('Ignore Ticket')
              .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
              .setCustomId(`tickets:button:report:deny:${ticketId}`)
              .setLabel('Deny Ticket')
              .setStyle(ButtonStyle.Danger),
          ),
        ];

        const sentMessage = await logChannel.send({ embeds: [embed], components });

        ticketState.set(ticketId, {
          type: 'other',
          phase: 1,
          messageId: sentMessage.id,
          channelId: sentMessage.channelId,
          guildId: guild.id,
          reporterTag: `${reporter.tag} (${reporter.id})`,
          description,
        });

        await interaction.reply({
          content:
            `Your ticket has been submitted to the moderation team. Your ticket ID is **${ticketId}**.`,
          ephemeral: true,
        });
      } catch (error) {
        console.error('[tickets] Error handling other support modal submission:', error);
        if (!interaction.replied && !interaction.deferred) {
          try {
            await interaction.reply({
              content: 'There was an error submitting your ticket. Please try again later.',
              ephemeral: true,
            });
          } catch {
            // Ignore follow-up failures
          }
        }
      }
    }

    if (interaction.customId?.startsWith('tickets:modal:decision:deny:')) {
      try {
        const guild = interaction.guild;
        if (!guild) {
          await interaction.reply({
            content: 'This form can only be used inside a server.',
            ephemeral: true,
          });
          return;
        }

        const parts = interaction.customId.split(':');
        const ticketId = parts[parts.length - 1];
        const reasonRaw = interaction.fields.getTextInputValue('deny_reason') ?? '';
        const reasonForDeny = reasonRaw.trim();

        const stored = ticketState.get(ticketId);

        if (stored && typeof stored === 'object') {
          stored.finalDecision = 'Denied';
          stored.finalReason = reasonForDeny || 'None provided';
          stored.finalizedBy = `${interaction.user.tag} (${interaction.user.id})`;
          stored.finalizedAt = new Date().toISOString();
        }

        if (stored && stored.channelId && stored.messageId) {
          try {
            const logChannel =
              guild.channels.cache.get(stored.channelId) ??
              (await guild.channels.fetch(stored.channelId).catch(() => null));

            if (logChannel && logChannel.isTextBased()) {
              const logMessage = await logChannel.messages
                .fetch(stored.messageId)
                .catch(() => null);

              if (logMessage && logMessage.deletable) {
                await logMessage.delete();
              }
            }
          } finally {
            ticketState.delete(ticketId);
          }
        } else {
          ticketState.delete(ticketId);
        }

        if (stored) {
          dmTicketPresenter(interaction.client, stored, {
            decision: 'Denied',
            reason: reasonForDeny || 'None provided',
          });
        }

        try {
          const logChannel = await guild.channels
            .fetch('1447705274243616809')
            .catch(() => null);

          if (logChannel && logChannel.isTextBased()) {
            const embed = new EmbedBuilder()
              .setTitle('Ticket Decision')
              .setColor(0x00ff0000)
              .addFields(
                { name: 'Ticket ID', value: ticketId, inline: true },
                { name: 'Decision', value: 'Denied', inline: true },
                {
                  name: 'Staff',
                  value: `${interaction.user.tag} (${interaction.user.id})`,
                  inline: false,
                },
                {
                  name: 'Reason for denial',
                  value: reasonForDeny || 'None provided',
                  inline: false,
                },
              )
              .setTimestamp();

            await logChannel.send({ embeds: [embed] });
          }
        } catch (error) {
          console.error(
            '[tickets] Failed to log denied ticket to ticket log channel:',
            error,
          );
        }

        await interaction.reply({
          content: `Ticket **${ticketId}** has been denied and logged.`,
          ephemeral: true,
        });
      } catch (error) {
        console.error('[tickets] Error handling deny ticket modal submission:', error);
        if (!interaction.replied && !interaction.deferred) {
          try {
            await interaction.reply({
              content: 'There was an error while denying this ticket. Please try again later.',
              ephemeral: true,
            });
          } catch {
            // Ignore follow-up failures
          }
        }
      }
    }
  }
});
client.on(Events.MessageCreate, async message => {
  if (message.author.bot) return;

  // DM forwarding from users to a staff channel
  if (!message.guild) {
    try {
      console.log('[dm-forward] Received DM from', message.author.tag, message.author.id);
      await appendDmToGroupedEmbed(message);
    } catch (error) {
      console.error('[dm-forward] Failed to forward DM:', error);
    }
    return;
  }

  try {
    const guildId = message.guild.id;

    const existingAfk = getAfk(guildId, message.author.id);

    if (existingAfk) {
      clearAfk(guildId, message.author.id);

      try {
        const member = await message.guild.members.fetch(message.author.id);
        const currentName = member.nickname ?? member.user.username;

        if (currentName.startsWith('[AFK] ') && member.manageable) {
          const newNickname = currentName.slice('[AFK] '.length);
          await member.setNickname(newNickname, 'Clear AFK status on message');
        }
      } catch (error) {
        console.error('[afk] Failed to clear nickname on message:', error);
      }

      try {
        const reply = await message.reply(`Welcome back ${message.author}, I removed your AFK.`);

        setTimeout(async () => {
          try {
            if (reply.deletable) {
              await reply.delete();
            }
          } catch (error) {
            console.error('[afk] Failed to delete welcome back message:', error);
          }
        }, 3000);
      } catch (error) {
        console.error('[afk] Failed to send welcome back message:', error);
      }
    }

    const mentions = message.mentions;
    if (!mentions || !mentions.users || mentions.users.size === 0) {
      return;
    }

    const lines = [];

    for (const [userId, user] of mentions.users) {
      if (userId === message.author.id) {
        continue;
      }

      const afk = getAfk(guildId, userId);
      if (afk) {
        const reason =
          typeof afk.reason === 'string' && afk.reason.trim().length
            ? afk.reason.trim()
            : 'No reason provided.';
        lines.push(`${user} is currently AFK: ${reason}`);
      }
    }

    if (lines.length > 0) {
      const reply = await message.reply({
        content: lines.join('\n'),
        allowedMentions: { users: [] },
      });

      setTimeout(async () => {
        try {
          if (message.deletable) {
            await message.delete();
          }
        } catch (error) {
          console.error('[afk] Failed to delete original AFK ping message:', error);
        }

        try {
          if (reply.deletable) {
            await reply.delete();
          }
        } catch (error) {
          console.error('[afk] Failed to delete AFK reply message:', error);
        }
      }, 5000);
    }
  } catch (error) {
    console.error('[afk] Failed to handle AFK mention:', error);
  }
});

client.on(Events.ThreadCreate, async thread => {
  try {
    if (!thread || thread.type !== ChannelType.GuildPublicThread) {
      return;
    }

    const parentId = thread.parentId;
    if (!parentId || !AUTO_VOTE_FORUM_CHANNEL_IDS.includes(parentId)) {
      return;
    }

    const guild = thread.guild;
    if (!guild) {
      return;
    }

    let autoVotesEnabled = true;
    try {
      const store = loadServersSafe();
      const guildConfig = store[guild.id] || {};
      if (guildConfig.forumAutoVotesEnabled === false) {
        autoVotesEnabled = false;
      }
    } catch (error) {
      console.error('[autovote] Failed to read forum auto-vote config:', error);
    }

    if (!autoVotesEnabled) {
      return;
    }

    let starter;
    try {
      starter = await thread.fetchStarterMessage();
    } catch (error) {
      console.error('[autovote] Failed to fetch starter message for thread:', error);
      return;
    }

    if (!starter || starter.author?.bot) {
      return;
    }

    try {
      await starter.react('⬆️');
    } catch (error) {
      console.error('[autovote] Failed to add upvote reaction to starter message:', error);
    }

    try {
      await starter.react('⬇️');
    } catch (error) {
      console.error('[autovote] Failed to add downvote reaction to starter message:', error);
    }
  } catch (error) {
    console.error('[autovote] Error handling ThreadCreate for forum auto-votes:', error);
  }
});

client.on(Events.MessageCreate, async message => {
  if (message.author.bot) return;
  if (!message.guild) return;

  try {
    const guildId = message.guild.id;
    const fromId = message.author.id;
    const rawContent = message.content || '';
    const content = rawContent.toLowerCase();

    if (!content.length) {
      return;
    }

    // Automod: check for blocked words/phrases and delete the message + warn the author.
    const automodRules = getAutomodRules(guildId);
    if (Array.isArray(automodRules) && automodRules.length > 0) {
      let triggeredRule = null;

      for (const rule of automodRules) {
        if (!rule || typeof rule.phrase !== 'string') {
          continue;
        }

        const phrase = rule.phrase.trim();
        if (!phrase.length) {
          continue;
        }

        if (content.includes(phrase.toLowerCase())) {
          triggeredRule = rule;
          break;
        }
      }

      if (triggeredRule) {
        try {
          const warning = await message.reply({
            content: `<@${fromId}> Your message was removed for using a blocked word.`,
            allowedMentions: { users: [fromId] },
          });

          setTimeout(async () => {
            try {
              if (warning.deletable) {
                await warning.delete();
              }
            } catch (error) {
              console.error('[automod] Failed to delete warning message:', error);
            }
          }, 3000);
        } catch (error) {
          console.error('[automod] Failed to send warning reply:', error);
        }

        try {
          if (message.deletable) {
            await message.delete();
          }
        } catch (error) {
          console.error('[automod] Failed to delete automodded message:', error);
        }

        return;
      }
    }
    // Reverse automod: check for celebratory words/phrases and reply "Yay!" without deleting messages.
    const reverseRules = getReverseAutomodRules(guildId);
    if (Array.isArray(reverseRules) && reverseRules.length > 0) {
      let triggeredReverse = null;

      for (const rule of reverseRules) {
        if (!rule || typeof rule.phrase !== 'string') {
          continue;
        }

        const phrase = rule.phrase.trim();
        if (!phrase.length) {
          continue;
        }

        if (content.includes(phrase.toLowerCase())) {
          triggeredReverse = rule;
          break;
        }
      }

      if (triggeredReverse) {
        try {
          await message.reply({
            content: 'Yay!',
          });
        } catch (error) {
          console.error('[reverse-automod] Failed to send Yay reply:', error);
        }
      }
    }

    const mentions = message.mentions;
    if (!mentions || !mentions.users || mentions.users.size === 0) {
      return;
    }

    let replyText = null;

    for (const [userId] of mentions.users) {
      if (userId === fromId) {
        continue;
      }

      const rule = getNoPingRule(guildId, userId);
      if (!rule || !rule.parseFor) {
        continue;
      }

      const needle = rule.parseFor.toLowerCase();
      if (!needle || !content.includes(needle)) {
        continue;
      }

      const baseResponse =
        typeof rule.response === 'string' && rule.response.trim().length
          ? rule.response.trim()
          : `don't ping regarding ${rule.parseFor}.`;

      replyText = baseResponse;
      break;
    }

    if (!replyText) {
      return;
    }

    await message.reply({
      content: `<@${fromId}> ${replyText}`,
      allowedMentions: { users: [fromId] },
    });
  } catch (error) {
    console.error('[noping] Failed to handle no-ping rule:', error);
  }
});

client.login(BOT_TOKEN);
