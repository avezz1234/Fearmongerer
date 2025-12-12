const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const NOTES_FILE = path.join(DATA_DIR, 'notes.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadNotes() {
  ensureDataDir();
  if (!fs.existsSync(NOTES_FILE)) return {};

  try {
    const raw = fs.readFileSync(NOTES_FILE, 'utf8');
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    console.error('Failed to read notes.json, starting fresh:', error);
    return {};
  }
}

function saveNotes(store) {
  ensureDataDir();
  try {
    fs.writeFileSync(NOTES_FILE, JSON.stringify(store, null, 2), 'utf8');
  } catch (error) {
    console.error('Failed to write notes.json:', error);
  }
}

function generateNoteId() {
  return crypto.randomBytes(4).toString('hex');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('note')
    .setDescription('Attach a moderation note to a user.')
    .setDMPermission(false)
    .addUserOption(option =>
      option
        .setName('target')
        .setDescription('User to attach the note to')
        .setRequired(true),
    )
    .addStringOption(option =>
      option
        .setName('text')
        .setDescription('Note text')
        .setRequired(true),
    ),
  async execute(interaction) {
    if (!interaction.guild) {
      await interaction.reply({
        content: 'This command can only be used in a server.',
        ephemeral: true,
      });
      return;
    }

    const targetUser = interaction.options.getUser('target', true);
    const rawText = interaction.options.getString('text', true);
    const text = rawText.trim();

    if (!text) {
      await interaction.reply({
        content: 'Note text cannot be empty.',
        ephemeral: true,
      });
      return;
    }

    const guildId = interaction.guild.id;
    const userId = targetUser.id;

    const store = loadNotes();
    if (!store[guildId]) store[guildId] = {};
    if (!Array.isArray(store[guildId][userId])) store[guildId][userId] = [];

    const id = generateNoteId();
    const nowIso = new Date().toISOString();

    const note = {
      id,
      text,
      createdBy: interaction.user.id,
      createdAt: nowIso,
    };

    store[guildId][userId].push(note);
    saveNotes(store);

    await interaction.reply({
      content: `? Added note for **${targetUser.tag}** (ID: ${id}).`,
      ephemeral: true,
    });
  },
};
