const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const WARN_FILE = path.join(DATA_DIR, 'warnings.json');
const MOD_FILE = path.join(DATA_DIR, 'moderations.json');
const NOTES_FILE = path.join(DATA_DIR, 'notes.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadWarningsSafe() {
  ensureDataDir();
  if (!fs.existsSync(WARN_FILE)) return {};

  try {
    const raw = fs.readFileSync(WARN_FILE, 'utf8');
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    console.error('Failed to read warnings.json for /info:', error);
    return {};
  }
}

function loadModerationsSafe() {
  ensureDataDir();
  if (!fs.existsSync(MOD_FILE)) return {};

  try {
    const raw = fs.readFileSync(MOD_FILE, 'utf8');
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    console.error('Failed to read moderations.json for /info:', error);
    return {};
  }
}

function loadNotesSafe() {
  ensureDataDir();
  if (!fs.existsSync(NOTES_FILE)) return {};

  try {
    const raw = fs.readFileSync(NOTES_FILE, 'utf8');
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    console.error('Failed to read notes.json for /info:', error);
    return {};
  }
}

function getWarnsForMember(guildId, userId, now) {
  const store = loadWarningsSafe();
  const guildStore = store[guildId] || {};
  const entries = Array.isArray(guildStore[userId]) ? guildStore[userId] : [];
  const active = entries.filter(entry => {
    if (!entry.expiresAt) return true;
    const ts = Date.parse(entry.expiresAt);
    return Number.isFinite(ts) && ts > now;
  });
  return { entries, active };
}

function getInvalidatedWarns(guildId, userId) {
  const store = loadModerationsSafe();
  const guildStore = store[guildId] || {};
  const records = Object.values(guildStore);

  return records.filter(record => record && record.type === 'warn' && record.targetId === userId && record.undone);
}

function getModerationSummary(guildId, userId) {
  const store = loadModerationsSafe();
  const guildStore = store[guildId] || {};

  const kicks = [];
  const bans = [];

  for (const [recordId, record] of Object.entries(guildStore)) {
    if (!record || record.targetId !== userId) continue;

    const normalized = { ...record };
    if (!normalized.id) {
      normalized.id = recordId;
    }

    if (normalized.type === 'kick') kicks.push(normalized);
    if (normalized.type === 'ban') bans.push(normalized);
  }

  function getLastIssuedAt(list) {
    let bestTs = null;
    for (const entry of list) {
      if (!entry.issuedAt) continue;
      const ts = Date.parse(entry.issuedAt);
      if (!Number.isFinite(ts)) continue;
      if (bestTs === null || ts > bestTs) bestTs = ts;
    }
    return bestTs;
  }

  const lastKickTs = getLastIssuedAt(kicks);
  const lastBanTs = getLastIssuedAt(bans);

  return {
    kicks,
    bans,
    kicksCount: kicks.length,
    bansCount: bans.length,
    lastKickTs,
    lastBanTs,
  };
}

function getNotesForMember(guildId, userId) {
  const store = loadNotesSafe();
  const guildStore = store[guildId] || {};
  const entries = Array.isArray(guildStore[userId]) ? guildStore[userId] : [];
  return entries;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('info')
    .setDescription('Show detailed moderation status, warnings, notes, and account info about a user.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false)
    .addUserOption(option =>
      option
        .setName('target')
        .setDescription('User to inspect (defaults to you)')
        .setRequired(false),
    )
    .addBooleanOption(option =>
      option
        .setName('ephemeral')
        .setDescription('Reply ephemerally (default true)')
        .setRequired(false),
    ),
  async execute(interaction) {
    const ephemeral = interaction.options.getBoolean('ephemeral') ?? true;
    const user = interaction.options.getUser('target') ?? interaction.user;

    if (!interaction.guild) {
      await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      return;
    }

    const now = Date.now();
    const guildId = interaction.guild.id;
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);

    const roles = member
      ? member.roles.cache
          .filter(role => role.id !== interaction.guild.id)
          .map(role => role.toString())
      : [];

    const accountCreatedUnix = Math.floor(user.createdTimestamp / 1000);
    const joinedUnix = member && member.joinedTimestamp ? Math.floor(member.joinedTimestamp / 1000) : null;

    const timeoutUntilTs =
      member && typeof member.communicationDisabledUntilTimestamp === 'number'
        ? member.communicationDisabledUntilTimestamp
        : null;
    const timeoutUnix = timeoutUntilTs && timeoutUntilTs > now ? Math.floor(timeoutUntilTs / 1000) : null;
    const isTimedOut = Boolean(timeoutUnix);

    const warns = getWarnsForMember(guildId, user.id, now);
    const totalWarns = warns.entries.length;
    const activeWarns = warns.active.length;

    const warnLines = warns.active.slice(0, 5).map((entry, index) => {
      const issuedTs = Date.parse(entry.issuedAt || '');
      const issuedUnix = Number.isFinite(issuedTs) ? Math.floor(issuedTs / 1000) : null;
      const when = issuedUnix ? `<t:${issuedUnix}:F>` : 'unknown time';
      const reason = entry.reason || 'No reason recorded.';
      const id = entry.id || 'unknown';
      return `${index + 1}. ${when} — ${reason} (ID: ${id})`;
    });

    const invalidatedWarns = getInvalidatedWarns(guildId, user.id);
    const invalidatedWarnsCount = invalidatedWarns.length;

    const invalidatedLines = invalidatedWarns.slice(0, 5).map((record, index) => {
      const id = record.id || 'unknown';
      const reason = record.reason || 'No reason recorded.';
      const undoReason = record.undoReason || 'No undo reason recorded.';
      const undoneTs = record.undoneAt ? Date.parse(record.undoneAt) : NaN;
      const undoneUnix = Number.isFinite(undoneTs) ? Math.floor(undoneTs / 1000) : null;
      const when = undoneUnix ? `<t:${undoneUnix}:F>` : 'unknown time';
      const undoneBy = record.undoneBy ? `<@${record.undoneBy}>` : 'unknown moderator';
      return `${index + 1}. ID: ${id} — ${reason} (undone by ${undoneBy} at ${when}; undo reason: ${undoReason})`;
    });

    const moderation = getModerationSummary(guildId, user.id);

    const bansForUser = Array.isArray(moderation.bans) ? moderation.bans : [];
    let banIdsField = null;

    if (bansForUser.length > 0) {
      const sorted = [...bansForUser].sort((a, b) => {
        const aTs = a && a.issuedAt ? Date.parse(a.issuedAt) : NaN;
        const bTs = b && b.issuedAt ? Date.parse(b.issuedAt) : NaN;
        const aScore = Number.isFinite(aTs) ? aTs : 0;
        const bScore = Number.isFinite(bTs) ? bTs : 0;
        return bScore - aScore;
      });

      const lines = sorted.slice(0, 10).map(record => {
        const id = record.id || 'unknown';
        const issuedTs = record.issuedAt ? Date.parse(record.issuedAt) : NaN;
        const issuedUnix = Number.isFinite(issuedTs) ? Math.floor(issuedTs / 1000) : null;
        const when = issuedUnix ? `<t:${issuedUnix}:F>` : 'unknown time';
        const status = record.undone ? 'UNBANNED' : 'BANNED';
        return `• ${status} — ${id} — ${when}`;
      });

      let value = lines.join('\n');
      if (sorted.length > 10) {
        value += `\n… and ${sorted.length - 10} more`;
      }
      if (value.length > 1024) {
        value = `${value.slice(0, 1010)}…`;
      }

      banIdsField = { name: 'Ban log (most recent first)', value, inline: false };
    }

    const notes = getNotesForMember(guildId, user.id);
    const notesCount = notes.length;

    const noteLines = notes
      .slice(-10)
      .reverse()
      .map((note, index) => {
      const createdTs = note.createdAt ? Date.parse(note.createdAt) : NaN;
      const createdUnix = Number.isFinite(createdTs) ? Math.floor(createdTs / 1000) : null;
      const when = createdUnix ? `<t:${createdUnix}:F>` : 'unknown time';
      const author = note.createdBy ? `<@${note.createdBy}>` : 'unknown moderator';
      const text = note.text || '(no text)';
      const id = note.id || 'unknown';
      return `${index + 1}. [${id}] ${text} (by ${author} at ${when})`;
    });

    const inServer = Boolean(member);
    const statusLines = [];

    if (inServer) {
      statusLines.push('Currently in this server.');
    } else {
      statusLines.push('Currently **not** in this server.');
    }

    let statusDetail = null;
    let statusWhenUnix = null;

    if (moderation.bansCount > 0 || moderation.kicksCount > 0) {
      const banTs = moderation.lastBanTs ?? null;
      const kickTs = moderation.lastKickTs ?? null;

      if (banTs && (!kickTs || banTs >= kickTs)) {
        statusDetail = 'banned';
        statusWhenUnix = Math.floor(banTs / 1000);
      } else if (kickTs) {
        statusDetail = 'kicked';
        statusWhenUnix = Math.floor(kickTs / 1000);
      }
    }

    if (!inServer) {
      if (statusDetail === 'banned') {
        if (statusWhenUnix) {
          statusLines.push(`Last recorded action: **banned** at <t:${statusWhenUnix}:F>.`);
        } else {
          statusLines.push('Last recorded action: **banned**.');
        }
      } else if (statusDetail === 'kicked') {
        if (statusWhenUnix) {
          statusLines.push(`Last recorded action: **kicked** at <t:${statusWhenUnix}:F>.`);
        } else {
          statusLines.push('Last recorded action: **kicked**.');
        }
      } else {
        statusLines.push('No kicks or bans recorded; likely left on their own or never joined this server.');
      }
    } else if (statusDetail) {
      if (statusDetail === 'banned' && statusWhenUnix) {
        statusLines.push(`Previously **banned** (last ban at <t:${statusWhenUnix}:F>).`);
      } else if (statusDetail === 'kicked' && statusWhenUnix) {
        statusLines.push(`Previously **kicked** (last kick at <t:${statusWhenUnix}:F>).`);
      }
    }

    const rawStatusValue = statusLines.join('\n');
    const statusValue = rawStatusValue.length > 1024 ? `${rawStatusValue.slice(0, 1010)}…` : rawStatusValue;

    const embed = new EmbedBuilder()
      .setTitle(`Info: ${user.tag}`)
      .setColor(0x005865f2)
      .setThumbnail(user.displayAvatarURL({ dynamic: true }))
      .addFields(
        { name: 'User ID', value: user.id, inline: false },
        { name: 'Account Created', value: `<t:${accountCreatedUnix}:F>`, inline: false },
        { name: 'Presence / moderation status', value: statusValue, inline: false },
      )
      .setTimestamp();

    const timeoutText = isTimedOut
      ? `Yes, until <t:${timeoutUnix}:F> (<t:${timeoutUnix}:R>)`
      : 'No active timeout';

    embed.addFields({ name: 'Current timeout', value: timeoutText, inline: false });

    if (joinedUnix) {
      embed.addFields({ name: 'Joined Server', value: `<t:${joinedUnix}:F>`, inline: false });
    }

    if (roles.length) {
      const rolesValue = roles.join(', ');
      embed.addFields({
        name: 'Roles',
        value: rolesValue.length > 1024 ? `${rolesValue.slice(0, 1010)}…` : rolesValue,
        inline: false,
      });
    } else {
      embed.addFields({ name: 'Roles', value: 'None', inline: false });
    }

    if (member) {
      embed.addFields(
        { name: 'Bannable', value: member.bannable ? 'Yes' : 'No', inline: true },
        { name: 'Kickable', value: member.kickable ? 'Yes' : 'No', inline: true },
        { name: 'Moderatable (timeout)', value: member.moderatable ? 'Yes' : 'No', inline: true },
      );
    } else {
      embed.addFields({ name: 'Guild Member', value: 'Not found in this server.', inline: false });
    }

    const summaryFields = [];

    let warningsValue =
      `Active: ${activeWarns}\n` +
      `Total known: ${totalWarns}`;

    if (warnLines.length > 0) {
      const list = warnLines.join('\n');
      const label = activeWarns > 0 ? 'Recent active warns:' : 'Recent warns:';
      warningsValue += `\n\n${label}\n${list}`;
    }

    warningsValue +=
      '\n\nUse `/inspect moderation_id:` for full details of a specific moderation.';

    if (warningsValue.length > 1024) {
      warningsValue = `${warningsValue.slice(0, 1010)}…`;
    }

    summaryFields.push({
      name: 'Warnings',
      value: warningsValue,
      inline: false,
    });

    if (invalidatedWarnsCount > 0) {
      summaryFields.push({
        name: 'Invalidated warns',
        value: `Total invalidated warns: ${invalidatedWarnsCount}`,
        inline: false,
      });
    }

    const moderationSummaryValue =
      `Kicks: ${moderation.kicksCount}\n` +
      `Bans: ${moderation.bansCount}\n` +
      `Notes: ${notesCount}`;

    summaryFields.push({
      name: 'Moderation summary',
      value: moderationSummaryValue,
      inline: false,
    });

    embed.addFields(...summaryFields);

    if (banIdsField) {
      embed.addFields(banIdsField);
    }

    let notesValue = noteLines.length ? noteLines.join('\n') : 'None';
    if (notesCount > 10 && noteLines.length) {
      notesValue += `\n… and ${notesCount - 10} more`;
    }
    if (notesValue.length > 1024) {
      notesValue = `${notesValue.slice(0, 1010)}…`;
    }

    embed.addFields({ name: 'Notes (most recent first)', value: notesValue, inline: false });

    await interaction.reply({ embeds: [embed], ephemeral });
  },
};
