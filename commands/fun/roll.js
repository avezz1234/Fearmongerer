const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('roll')
    .setDescription('Roll a die and show debug-friendly details.')
    .addIntegerOption(option =>
      option
        .setName('sides')
        .setDescription('Number of sides on the die (default 6)')
        .setMinValue(2)
        .setMaxValue(1000),
    ),
  async execute(interaction) {
    const start = Date.now();
    const sides = interaction.options.getInteger('sides') ?? 6;
    const result = Math.floor(Math.random() * sides) + 1;

    await interaction.deferReply({ ephemeral: true });

    const wsPing = Math.round(interaction.client.ws.ping);
    const apiLatency = Date.now() - interaction.createdTimestamp;
    const responseDelay = Date.now() - start;

    const embed = new EmbedBuilder()
      .setTitle('Roll Debug')
      .setColor(0x00ffcc00)
      .addFields(
        { name: 'Result', value: `${result}`, inline: true },
        { name: 'Sides', value: `${sides}`, inline: true },
        { name: 'User', value: `${interaction.user.tag}`, inline: true },
        { name: 'WebSocket Ping', value: `${wsPing} ms`, inline: true },
        { name: 'API Latency', value: `${apiLatency} ms`, inline: true },
        { name: 'Response Delay', value: `${responseDelay} ms`, inline: true },
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};
