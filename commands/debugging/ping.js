const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Shows network stats and latency.'),
  async execute(interaction) {
    const start = Date.now();

    await interaction.deferReply({ ephemeral: true });

    const wsPing = Math.round(interaction.client.ws.ping);
    const apiLatency = Date.now() - interaction.createdTimestamp;
    const responseDelay = Date.now() - start;

    const embed = new EmbedBuilder()
      .setTitle('Pong! Network Stats')
      .setColor(0x0000ff99)
      .addFields(
        { name: 'WebSocket Ping', value: `${wsPing} ms`, inline: true },
        { name: 'API Latency', value: `${apiLatency} ms`, inline: true },
        { name: 'Response Delay', value: `${responseDelay} ms`, inline: true }
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};
