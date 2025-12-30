require("dotenv").config();
const { 
    Client, 
    GatewayIntentBits, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle,
    SlashCommandBuilder,
    Routes,
    REST,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require("discord.js");
const sqlite3 = require("sqlite3").verbose();

// Verificar variáveis de ambiente
console.log("🔧 Verificando configuração...");

if (!process.env.DISCORD_BOT_TOKEN) {
    console.error("❌ ERRO: DISCORD_BOT_TOKEN não encontrado no .env");
    console.log("💡 Adicione no .env: DISCORD_BOT_TOKEN=seu_token_aqui");
    process.exit(1);
}

if (!process.env.DISCORD_CLIENT_ID) {
    console.error("❌ ERRO: DISCORD_CLIENT_ID não encontrado no .env");
    console.log("💡 Adicione no .env: DISCORD_CLIENT_ID=seu_client_id_aqui");
    process.exit(1);
}

const db = new sqlite3.Database("./whitelist.db");

/* ================= CONFIG ================= */

const ADMINS = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',').filter(id => id.trim()) : [];
const CLIENT_ID = process.env.DISCORD_CLIENT_ID.trim();
const GUILD_ID = process.env.GUILD_ID ? process.env.GUILD_ID.trim() : null;

console.log("⚙️  Configuração carregada:");
console.log(`   - Client ID: ${CLIENT_ID}`);
console.log(`   - Guild ID: ${GUILD_ID || 'Não definido (comandos globais)'}`);
console.log(`   - Admins: ${ADMINS.length} configurado(s)`);

if (ADMINS.length === 0) {
    console.warn("⚠️  Nenhum admin configurado. Adicione no .env: ADMIN_IDS=seu_id_discord");
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMembers
    ]
});

/* ================= SLASH COMMANDS CONFIG ================= */

const commands = [
    new SlashCommandBuilder()
        .setName('whitelist')
        .setDescription('📋 Sistema de whitelist Cidade Alta RP')
        .addSubcommand(sub =>
            sub.setName('pendentes')
                .setDescription('Ver formulários pendentes de aprovação'))
        .addSubcommand(sub =>
            sub.setName('stats')
                .setDescription('Ver estatísticas das whitelists'))
        .addSubcommand(sub =>
            sub.setName('buscar')
                .setDescription('Buscar formulário por ID, Discord ou Roblox')
                .addStringOption(option =>
                    option.setName('query')
                        .setDescription('ID, Discord ID ou Nick Roblox')
                        .setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('revisar')
                .setDescription('Revisar formulário específico')
                .addStringOption(option =>
                    option.setName('id')
                        .setDescription('ID do formulário')
                        .setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('aprovar')
                .setDescription('Aprovar formulário diretamente')
                .addStringOption(option =>
                    option.setName('id')
                        .setDescription('ID do formulário')
                        .setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('reprovar')
                .setDescription('Reprovar formulário com motivo')
                .addStringOption(option =>
                    option.setName('id')
                        .setDescription('ID do formulário')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('motivo')
                        .setDescription('Motivo da reprovação')
                        .setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('help')
                .setDescription('Mostra ajuda sobre os comandos'))
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);

/* ================= REGISTER COMMANDS ON STARTUP ================= */

async function registerSlashCommands() {
    try {
        console.log('\n🔄 Registrando comandos slash...');
        
        // Registrar comandos GLOBAIS
        console.log('🌐 Registrando comandos globais...');
        const globalCommands = await rest.put(
            Routes.applicationCommands(CLIENT_ID),
            { body: commands }
        );
        console.log(`✅ ${globalCommands.length} comandos registrados GLOBALMENTE`);
        
        // Registrar comandos no servidor específico (aparece mais rápido)
        if (GUILD_ID) {
            console.log(`🏠 Registrando comandos no servidor ${GUILD_ID}...`);
            try {
                const guildCommands = await rest.put(
                    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
                    { body: commands }
                );
                console.log(`✅ ${guildCommands.length} comandos registrados no servidor`);
                console.log('   ⚡ Comandos aparecerão IMEDIATAMENTE neste servidor!');
            } catch (guildError) {
                console.warn(`⚠️  Não foi possível registrar comandos no servidor: ${guildError.message}`);
                console.log('💡 Verifique se o GUILD_ID está correto e se o bot está no servidor');
            }
        } else {
            console.log('ℹ️  GUILD_ID não definido. Comandos serão globais.');
            console.log('⏰ Comandos globais podem levar até 1 hora para aparecer em todos servidores.');
        }
        
        console.log('\n📋 Comandos disponíveis:');
        console.log('   /whitelist pendentes  - Ver formulários pendentes');
        console.log('   /whitelist stats      - Ver estatísticas');
        console.log('   /whitelist buscar     - Buscar formulário');
        console.log('   /whitelist revisar    - Revisar formulário');
        console.log('   /whitelist aprovar    - Aprovar formulário');
        console.log('   /whitelist reprovar   - Reprovar formulário');
        console.log('   /whitelist help       - Ajuda');
        
    } catch (error) {
        console.error('❌ Erro ao registrar comandos:', error.message);
        
        if (error.code === 50001) {
            console.error('\n🔒 ERRO DE PERMISSÃO: O bot não tem acesso!');
            console.error('Use este link para convidar o bot:');
            console.error(`https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&permissions=8&scope=bot%20applications.commands`);
        } else if (error.code === 50013) {
            console.error('\n🔒 PERMISSÕES INSUFICIENTES:');
            console.error('O bot precisa da permissão "Use Slash Commands"');
        }
    }
}

/* ================= DM SYSTEM ================= */

async function sendDMToUser(userId, title, description, fields, color) {
    try {
        const user = await client.users.fetch(userId);
        
        if (!user) {
            console.log(`❌ Usuário ${userId} não encontrado`);
            return false;
        }

        const embed = new EmbedBuilder()
            .setTitle(title)
            .setDescription(description)
            .setColor(color)
            .setFooter({ text: 'Cidade Alta RP • St Studios' })
            .setTimestamp();

        if (fields && fields.length > 0) {
            embed.addFields(...fields);
        }

        await user.send({ embeds: [embed] });
        console.log(`✅ DM enviada para ${user.tag} (${userId})`);
        return true;
        
    } catch (error) {
        if (error.code === 50007) { // Cannot send messages to this user
            console.log(`⚠️  Não foi possível enviar DM para ${userId} (usuário bloqueou DMs)`);
        } else {
            console.error(`❌ Erro ao enviar DM para ${userId}:`, error.message);
        }
        return false;
    }
}

/* ================= BOT FUNCTIONS ================= */

async function sendFormEmbed(channel, form, withButtons = true) {
    const statusColors = {
        'pendente': 0xF59E0B, // Amarelo
        'aprovado': 0x10B981, // Verde
        'reprovado': 0xEF4444  // Vermelho
    };

    const embed = new EmbedBuilder()
        .setTitle(`📄 Whitelist - ${form.status.toUpperCase()}`)
        .setColor(statusColors[form.status] || 0xA855F7)
        .addFields(
            { name: '👤 Discord', value: `${form.discord_name} (\`${form.discord_id}\`)`, inline: true },
            { name: '🎮 Roblox', value: form.roblox || 'Não informado', inline: true },
            { name: '📅 Idade', value: form.idade || 'Não informado', inline: true },
            { name: '🆔 ID', value: `\`${form.id}\``, inline: true },
            { name: '📅 Enviado em', value: new Date(form.created_at).toLocaleDateString('pt-BR'), inline: true },
            { name: '📊 Status', value: form.status.toUpperCase(), inline: true }
        )
        .setFooter({ text: `Cidade Alta RP • St Studios • ID: ${form.id}` })
        .setTimestamp();

    if (form.experiencia && form.experiencia.length > 0) {
        const expPreview = form.experiencia.length > 300 ? 
            form.experiencia.substring(0, 300) + '...' : 
            form.experiencia;
        embed.addFields({ name: '📝 Experiência', value: expPreview });
    }

    if (form.motivo_reprova && form.motivo_reprova.length > 0) {
        embed.addFields({ 
            name: '❌ Motivo da Reprovação', 
            value: form.motivo_reprova.length > 500 ? 
                form.motivo_reprova.substring(0, 500) + '...' : 
                form.motivo_reprova 
        });
    }

    if (withButtons && form.status === 'pendente') {
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`aprovar_${form.id}`)
                .setLabel('✅ Aprovar')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`reprovar_${form.id}`)
                .setLabel('❌ Reprovar')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId(`ver_${form.id}`)
                .setLabel('👁️ Detalhes')
                .setStyle(ButtonStyle.Secondary)
        );
        return await channel.send({ embeds: [embed], components: [row] });
    }

    return await channel.send({ embeds: [embed] });
}

/* ================= BOT EVENTS ================= */

client.once("ready", async () => {
    console.log(`\n🤖 ${client.user.tag} online!`);
    console.log(`📊 Servindo ${client.guilds.cache.size} servidor(es)`);
    
    // Listar servidores
    console.log('\n🏠 Servidores conectados:');
    client.guilds.cache.forEach(guild => {
        console.log(`   - ${guild.name} (ID: ${guild.id})`);
        if (GUILD_ID && guild.id === GUILD_ID) {
            console.log(`     ✅ Este é o servidor configurado no .env`);
        }
    });
    
    // Registrar comandos slash
    await registerSlashCommands();
    
    // Status do bot
    client.user.setPresence({
        activities: [{ 
            name: 'Cidade Alta RP | /whitelist', 
            type: 3 // WATCHING
        }],
        status: 'online'
    });
    
    console.log('\n✅ Bot pronto! Digite /whitelist no Discord.');
    console.log('🔄 Caso os comandos não apareçam:');
    console.log('   1. Saia e entre novamente no servidor');
    console.log('   2. Reinicie o Discord');
    console.log('   3. Tente em um canal diferente');
});

/* ================= SLASH COMMAND HANDLER ================= */

client.on('interactionCreate', async interaction => {
    // Comandos slash
    if (interaction.isCommand()) {
        console.log(`\n📝 Comando recebido: /${interaction.commandName} por ${interaction.user.tag} (${interaction.user.id})`);
        
        // Verificar se é admin
        if (!ADMINS.includes(interaction.user.id)) {
            console.log(`❌ Acesso negado: ${interaction.user.tag} não é admin`);
            return interaction.reply({ 
                content: '❌ Apenas administradores podem usar este comando.',
                ephemeral: true 
            });
        }

        const { commandName, options } = interaction;

        if (commandName === 'whitelist') {
            const subCommand = options.getSubcommand();

            switch (subCommand) {
                case 'pendentes':
                    await interaction.deferReply({ ephemeral: false });
                    
                    db.all(`SELECT * FROM formularios WHERE status='pendente' ORDER BY created_at DESC LIMIT 10`, async (err, rows) => {
                        if (err) {
                            console.error('❌ Erro no banco de dados:', err);
                            return interaction.editReply('❌ Erro ao buscar formulários.');
                        }
                        
                        if (!rows.length) {
                            return interaction.editReply('✅ Nenhum formulário pendente no momento.');
                        }
                        
                        await interaction.editReply(`📋 **${rows.length} formulário(s) pendente(s):**`);
                        
                        for (const form of rows) {
                            await sendFormEmbed(interaction.channel, form, true);
                        }
                    });
                    break;

                case 'stats':
                    await interaction.deferReply({ ephemeral: false });
                    
                    db.all(`SELECT status, COUNT(*) as count FROM formularios GROUP BY status`, (err, rows) => {
                        if (err) {
                            console.error('❌ Erro no banco de dados:', err);
                            return interaction.editReply('❌ Erro ao buscar estatísticas.');
                        }
                        
                        const embed = new EmbedBuilder()
                            .setTitle('📊 Estatísticas da Whitelist')
                            .setColor(0xA855F7)
                            .setFooter({ text: 'Cidade Alta RP • St Studios' })
                            .setTimestamp();
                        
                        let total = 0;
                        rows.forEach(row => {
                            embed.addFields({ 
                                name: row.status.toUpperCase(), 
                                value: `${row.count}`, 
                                inline: true 
                            });
                            total += row.count;
                        });
                        
                        embed.addFields({ 
                            name: '📈 TOTAL', 
                            value: `${total} formulário(s)`, 
                            inline: false 
                        });
                        
                        interaction.editReply({ embeds: [embed] });
                    });
                    break;

                case 'buscar':
                    const query = options.getString('query');
                    await interaction.deferReply({ ephemeral: false });
                    
                    db.all(
                        `SELECT * FROM formularios WHERE id = ? OR discord_id = ? OR discord_name LIKE ? OR roblox LIKE ? LIMIT 10`,
                        [query, query, `%${query}%`, `%${query}%`],
                        async (err, forms) => {
                            if (err) {
                                console.error('❌ Erro no banco de dados:', err);
                                return interaction.editReply('❌ Erro ao buscar.');
                            }
                            
                            if (!forms.length) {
                                return interaction.editReply('❌ Nenhum formulário encontrado.');
                            }
                            
                            await interaction.editReply(`🔍 **${forms.length} resultado(s) encontrado(s):**`);
                            
                            for (const form of forms) {
                                await sendFormEmbed(interaction.channel, form, false);
                            }
                        }
                    );
                    break;

                case 'revisar':
                    const id = options.getString('id');
                    await interaction.deferReply({ ephemeral: false });
                    
                    db.get(`SELECT * FROM formularios WHERE id = ?`, [id], (err, form) => {
                        if (err) {
                            console.error('❌ Erro no banco de dados:', err);
                            return interaction.editReply('❌ Erro ao buscar formulário.');
                        }
                        
                        if (!form) {
                            return interaction.editReply('❌ Formulário não encontrado.');
                        }
                        
                        const embed = new EmbedBuilder()
                            .setTitle(`📄 Formulário #${form.id}`)
                            .setColor(0xA855F7)
                            .addFields(
                                { name: '👤 Discord', value: `${form.discord_name} (\`${form.discord_id}\`)` },
                                { name: '🎮 Roblox', value: form.roblox || 'Não informado' },
                                { name: '📅 Idade', value: form.idade || 'Não informado' },
                                { name: '📊 Status', value: form.status.toUpperCase() },
                                { name: '📅 Criado em', value: new Date(form.created_at).toLocaleString('pt-BR') },
                                { name: '🔄 Atualizado em', value: new Date(form.updated_at).toLocaleString('pt-BR') }
                            );
                        
                        if (form.experiencia && form.experiencia.length > 0) {
                            const experiencia = form.experiencia.length > 2000 ? 
                                form.experiencia.substring(0, 2000) + '...' : 
                                form.experiencia;
                            embed.addFields({ name: '📝 Experiência', value: experiencia });
                        }
                        
                        if (form.motivo_reprova && form.motivo_reprova.length > 0) {
                            embed.addFields({ 
                                name: '❌ Motivo da Reprovação', 
                                value: form.motivo_reprova 
                            });
                        }
                        
                        // Adicionar botões se estiver pendente
                        let components = [];
                        if (form.status === 'pendente') {
                            const row = new ActionRowBuilder().addComponents(
                                new ButtonBuilder()
                                    .setCustomId(`aprovar_${form.id}`)
                                    .setLabel('✅ Aprovar')
                                    .setStyle(ButtonStyle.Success),
                                new ButtonBuilder()
                                    .setCustomId(`reprovar_${form.id}`)
                                    .setLabel('❌ Reprovar')
                                    .setStyle(ButtonStyle.Danger)
                            );
                            components = [row];
                        }
                        
                        interaction.editReply({ 
                            embeds: [embed], 
                            components: components 
                        });
                    });
                    break;

                case 'aprovar':
                    const approveId = options.getString('id');
                    await interaction.deferReply({ ephemeral: true });
                    
                    db.run(`UPDATE formularios SET status='aprovado', updated_at=CURRENT_TIMESTAMP WHERE id=?`, [approveId], async (err) => {
                        if (err) {
                            console.error('❌ Erro no banco de dados:', err);
                            return interaction.editReply('❌ Erro ao aprovar formulário.');
                        }
                        
                        db.get(`SELECT * FROM formularios WHERE id=?`, [approveId], async (err, form) => {
                            if (err || !form) {
                                return interaction.editReply('❌ Formulário não encontrado.');
                            }

                            // Enviar DM de APROVAÇÃO
                            const dmSent = await sendDMToUser(
                                form.discord_id,
                                '✅ WHITELIST APROVADA!',
                                `**Parabéns ${form.discord_name}!**\n\nSeu formulário para o servidor **Cidade Alta RP** foi **APROVADO**! 🎉\n\nAgora você pode acessar o servidor e começar sua jornada no roleplay.`,
                                [
                                    { name: '🎮 Seu Nick Roblox', value: form.roblox || 'Não informado', inline: true },
                                    { name: '📅 Data da Aprovação', value: new Date().toLocaleDateString('pt-BR'), inline: true },
                                    { name: '🔑 Próximo Passo', value: 'Entre no servidor do Discord para receber as instruções de acesso ao servidor Roblox.', inline: false }
                                ],
                                0x10B981 // Verde
                            );

                            interaction.editReply({ 
                                content: `✅ Formulário #${approveId} aprovado com sucesso! ${dmSent ? 'DM enviada para o jogador.' : 'Não foi possível enviar DM (usuário bloqueou mensagens).'}`,
                                ephemeral: true
                            });
                            
                            console.log(`✅ Formulário #${approveId} aprovado por ${interaction.user.tag}`);
                        });
                    });
                    break;

                case 'reprovar':
                    const rejectId = options.getString('id');
                    const motivo = options.getString('motivo');
                    await interaction.deferReply({ ephemeral: true });
                    
                    if (motivo.length < 5) {
                        return interaction.editReply('❌ O motivo da reprovação deve ter pelo menos 5 caracteres.');
                    }
                    
                    db.run(
                        `UPDATE formularios SET status='reprovado', motivo_reprova=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
                        [motivo, rejectId],
                        async (err) => {
                            if (err) {
                                console.error('❌ Erro no banco de dados:', err);
                                return interaction.editReply('❌ Erro ao reprovar formulário.');
                            }
                            
                            db.get(`SELECT * FROM formularios WHERE id=?`, [rejectId], async (err, form) => {
                                if (err || !form) {
                                    return interaction.editReply('❌ Formulário não encontrado.');
                                }

                                // Enviar DM de REPROVAÇÃO
                                const dmSent = await sendDMToUser(
                                    form.discord_id,
                                    '❌ WHITELIST REPROVADA',
                                    `Olá ${form.discord_name},\n\nSeu formulário para o servidor **Cidade Alta RP** foi **REPROVADO**.\n\n**Por favor, leia atentamente o motivo abaixo e corrija os pontos mencionados antes de enviar novamente.**`,
                                    [
                                        { name: '📋 Motivo da reprovação', value: motivo },
                                        { name: '🎮 Seu Nick Roblox', value: form.roblox || 'Não informado', inline: true },
                                        { name: '🔄 O que fazer agora?', value: 'Corrija os pontos mencionados acima e envie um **novo formulário** no site. Você pode fazer isso agora mesmo.', inline: false },
                                        { name: '💡 Dica', value: 'Seja mais detalhado em sua experiência e garanta que atende todos os requisitos.', inline: false }
                                    ],
                                    0xEF4444 // Vermelho
                                );

                                interaction.editReply({ 
                                    content: `❌ Formulário #${rejectId} reprovado com sucesso! ${dmSent ? 'DM enviada para o jogador.' : 'Não foi possível enviar DM (usuário bloqueou mensagens).'}`,
                                    ephemeral: true
                                });
                                
                                console.log(`❌ Formulário #${rejectId} reprovado por ${interaction.user.tag}`);
                            });
                        }
                    );
                    break;

                case 'help':
                    const helpEmbed = new EmbedBuilder()
                        .setTitle('📋 AJUDA - Comandos Whitelist')
                        .setDescription('Comandos disponíveis para administradores:')
                        .setColor(0xA855F7)
                        .addFields(
                            { name: '/whitelist pendentes', value: 'Ver formulários pendentes de aprovação' },
                            { name: '/whitelist stats', value: 'Ver estatísticas de todos os formulários' },
                            { name: '/whitelist buscar [query]', value: 'Buscar formulário por ID, Discord ID ou Nick Roblox' },
                            { name: '/whitelist revisar [id]', value: 'Revisar um formulário específico em detalhes' },
                            { name: '/whitelist aprovar [id]', value: 'Aprovar um formulário diretamente' },
                            { name: '/whitelist reprovar [id] [motivo]', value: 'Reprovar um formulário com motivo obrigatório' },
                            { name: 'Comando alternativo', value: 'Use `!pendentes` em qualquer canal para ver pendentes' }
                        )
                        .setFooter({ text: 'Cidade Alta RP • St Studios' });
                    
                    interaction.reply({ embeds: [helpEmbed], ephemeral: true });
                    break;
            }
        }
    }

    // Botões
    if (interaction.isButton()) {
        console.log(`🔘 Botão clicado: ${interaction.customId} por ${interaction.user.tag}`);
        
        if (!ADMINS.includes(interaction.user.id)) {
            return interaction.reply({ 
                content: "❌ Apenas administradores podem usar estes botões.", 
                ephemeral: true 
            });
        }

        const [action, id] = interaction.customId.split("_");

        if (action === 'ver') {
            db.get(`SELECT * FROM formularios WHERE id = ?`, [id], (err, form) => {
                if (err || !form) {
                    return interaction.reply({ content: '❌ Formulário não encontrado.', ephemeral: true });
                }
                
                const embed = new EmbedBuilder()
                    .setTitle(`📄 Experiência Completa - Formulário #${form.id}`)
                    .setDescription(`**Experiência em RP:**\n\n${form.experiencia || 'Não informada'}`)
                    .setColor(0xA855F7)
                    .addFields(
                        { name: '👤 Discord', value: form.discord_name, inline: true },
                        { name: '🎮 Roblox', value: form.roblox || 'Não informado', inline: true },
                        { name: '📅 Enviado em', value: new Date(form.created_at).toLocaleString('pt-BR'), inline: true }
                    )
                    .setFooter({ text: `Cidade Alta RP • ID: ${form.id}` });
                
                interaction.reply({ embeds: [embed], ephemeral: true });
            });
            return;
        }

        if (action === 'aprovar') {
            await interaction.deferReply({ ephemeral: true });
            
            db.run(`UPDATE formularios SET status='aprovado', updated_at=CURRENT_TIMESTAMP WHERE id=?`, [id], async (err) => {
                if (err) {
                    console.error('❌ Erro no banco de dados:', err);
                    return interaction.editReply('❌ Erro ao aprovar formulário.');
                }

                db.get(`SELECT * FROM formularios WHERE id=?`, [id], async (err, form) => {
                    if (err || !form) {
                        return interaction.editReply('❌ Formulário não encontrado.');
                    }

                    // Enviar DM de APROVAÇÃO
                    const dmSent = await sendDMToUser(
                        form.discord_id,
                        '✅ WHITELIST APROVADA!',
                        `**Parabéns ${form.discord_name}!**\n\nSeu formulário para o servidor **Cidade Alta RP** foi **APROVADO**! 🎉`,
                        [
                            { name: '🎮 Seu Nick Roblox', value: form.roblox || 'Não informado', inline: true },
                            { name: '📅 Data da Aprovação', value: new Date().toLocaleDateString('pt-BR'), inline: true },
                            { name: '🔑 Próximo Passo', value: 'Entre no servidor do Discord para receber instruções de acesso.', inline: false }
                        ],
                        0x10B981 // Verde
                    );

                    interaction.editReply({ 
                        content: `✅ Formulário #${id} aprovado com sucesso! ${dmSent ? 'DM enviada.' : 'DM não enviada (usuário bloqueou mensagens).'}`
                    });
                    
                    // Atualizar a mensagem original
                    if (interaction.message && interaction.message.editable) {
                        try {
                            const oldEmbed = interaction.message.embeds[0];
                            const newEmbed = EmbedBuilder.from(oldEmbed)
                                .setColor(0x10B981)
                                .spliceFields(4, 1, { name: '📊 Status', value: '✅ APROVADO', inline: true });
                            
                            await interaction.message.edit({ 
                                embeds: [newEmbed], 
                                components: [] 
                            });
                        } catch (editError) {
                            console.log('⚠️  Não foi possível atualizar a mensagem original:', editError.message);
                        }
                    }
                });
            });
        }

        if (action === 'reprovar') {
            // Criar modal para motivo
            const modal = new ModalBuilder()
                .setCustomId(`reprovar_modal_${id}`)
                .setTitle('Reprovar Whitelist')
                .setComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('motivo')
                            .setLabel('Motivo da reprovação (obrigatório)')
                            .setStyle(TextInputStyle.Paragraph)
                            .setMinLength(10)
                            .setMaxLength(1000)
                            .setPlaceholder('Explique detalhadamente o motivo da reprovação para que o jogador possa corrigir...')
                            .setRequired(true)
                    )
                );

            await interaction.showModal(modal);
        }
    }

    // Modal submit
    if (interaction.isModalSubmit()) {
        if (!interaction.customId.startsWith('reprovar_modal_')) return;
        
        const id = interaction.customId.split('_')[2];
        const motivo = interaction.fields.getTextInputValue('motivo');
        
        await interaction.deferReply({ ephemeral: true });
        
        if (motivo.length < 10) {
            return interaction.editReply('❌ O motivo deve ter pelo menos 10 caracteres.');
        }
        
        db.run(
            `UPDATE formularios SET status='reprovado', motivo_reprova=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
            [motivo, id],
            async (err) => {
                if (err) {
                    console.error('❌ Erro no banco de dados:', err);
                    return interaction.editReply('❌ Erro ao reprovar formulário.');
                }

                db.get(`SELECT * FROM formularios WHERE id=?`, [id], async (err, form) => {
                    if (err || !form) {
                        return interaction.editReply('❌ Formulário não encontrado.');
                    }

                    // Enviar DM de REPROVAÇÃO
                    const dmSent = await sendDMToUser(
                        form.discord_id,
                        '❌ WHITELIST REPROVADA',
                        `Olá ${form.discord_name},\n\nSeu formulário para o servidor **Cidade Alta RP** foi **REPROVADO**.`,
                        [
                            { name: '📋 Motivo da reprovação', value: motivo },
                            { name: '🎮 Seu Nick Roblox', value: form.roblox || 'Não informado', inline: true },
                            { name: '🔄 O que fazer?', value: 'Corrija os pontos mencionados acima e envie um **novo formulário** no site.', inline: false },
                            { name: '💡 Dica', value: 'Leia atentamente o motivo e melhore sua resposta antes de enviar novamente.', inline: false }
                        ],
                        0xEF4444 // Vermelho
                    );

                    interaction.editReply({ 
                        content: `❌ Formulário #${id} reprovado com sucesso! ${dmSent ? 'DM enviada.' : 'DM não enviada (usuário bloqueou mensagens).'}`
                    });
                    
                    // Atualizar a mensagem original
                    if (interaction.message?.editable) {
                        try {
                            const oldEmbed = interaction.message.embeds[0];
                            const newEmbed = EmbedBuilder.from(oldEmbed)
                                .setColor(0xEF4444)
                                .spliceFields(4, 1, { name: '📊 Status', value: '❌ REPROVADO', inline: true })
                                .addFields({ 
                                    name: '❌ Motivo da Reprovação', 
                                    value: motivo.length > 500 ? motivo.substring(0, 500) + '...' : motivo 
                                });
                            
                            await interaction.message.edit({ 
                                embeds: [newEmbed], 
                                components: [] 
                            });
                        } catch (editError) {
                            console.log('⚠️  Não foi possível atualizar a mensagem original:', editError.message);
                        }
                    }
                });
            }
        );
    }
});

/* ================= COMMAND BY MESSAGE (LEGACY) ================= */

client.on("messageCreate", (msg) => {
    if (msg.author.bot) return;
    
    // Comando !pendentes (compatibilidade)
    if (msg.content === "!pendentes" || msg.content === "!pendente") {
        console.log(`📝 Comando legado: ${msg.content} por ${msg.author.tag}`);
        
        if (!ADMINS.includes(msg.author.id)) {
            return msg.reply("❌ Apenas administradores podem usar este comando.");
        }
        
        db.all(`SELECT * FROM formularios WHERE status='pendente' ORDER BY created_at DESC LIMIT 10`, async (err, rows) => {
            if (err) {
                console.error('❌ Erro no banco de dados:', err);
                return msg.reply("❌ Erro ao buscar formulários.");
            }
            
            if (!rows.length) {
                return msg.reply("✅ Nenhum formulário pendente no momento.");
            }
            
            await msg.reply(`📋 **${rows.length} formulário(s) pendente(s):**`);
            
            for (const form of rows) {
                const embed = new EmbedBuilder()
                    .setTitle("📄 Whitelist Pendente")
                    .setColor(0xF59E0B)
                    .addFields(
                        { name: "👤 Discord", value: form.discord_name, inline: true },
                        { name: "🎮 Roblox", value: form.roblox || "Não informado", inline: true },
                        { name: "📅 Idade", value: form.idade || "Não informado", inline: true },
                        { name: "🆔 ID", value: `\`${form.id}\``, inline: true },
                        { name: "📅 Enviado em", value: new Date(form.created_at).toLocaleDateString('pt-BR'), inline: true }
                    )
                    .setFooter({ text: `Cidade Alta RP • ID: ${form.id}` })
                    .setTimestamp();

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`aprovar_${form.id}`)
                        .setLabel("✅ Aprovar")
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId(`reprovar_${form.id}`)
                        .setLabel("❌ Reprovar")
                        .setStyle(ButtonStyle.Danger),
                    new ButtonBuilder()
                        .setCustomId(`ver_${form.id}`)
                        .setLabel("👁️ Detalhes")
                        .setStyle(ButtonStyle.Secondary)
                );

                await msg.channel.send({ embeds: [embed], components: [row] });
            }
        });
    }
    
    // Comando de ajuda
    if (msg.content === "!whitelist" || msg.content === "!wlhelp" || msg.content === "!wl") {
        const embed = new EmbedBuilder()
            .setTitle("🤖 Sistema de Whitelist - Cidade Alta RP")
            .setDescription("**Comandos disponíveis:**")
            .setColor(0xA855F7)
            .addFields(
                { name: "🆕 Comandos Slash (Recomendado)", value: "Digite `/` no chat e selecione `/whitelist` para ver todos os comandos" },
                { name: "🔄 Comando Legado", value: "`!pendentes` - Ver formulários pendentes" },
                { name: "📋 Subcomandos Slash", value: "`pendentes`, `stats`, `buscar`, `revisar`, `aprovar`, `reprovar`, `help`" }
            )
            .setFooter({ text: "Cidade Alta RP • St Studios" });
        
        msg.reply({ embeds: [embed] });
    }
});

/* ================= BOT LOGIN ================= */

console.log('\n🔗 Conectando ao Discord...');
client.login(process.env.DISCORD_BOT_TOKEN).catch(error => {
    console.error('❌ ERRO AO CONECTAR:', error.message);
    console.log('\n🔧 SOLUÇÃO:');
    console.log('1. Verifique se o DISCORD_BOT_TOKEN no .env está correto');
    console.log('2. O token deve começar com: MTA, MTI, MTk, etc.');
    console.log('3. Link para convidar o bot:');
    console.log(`https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&permissions=8&scope=bot%20applications.commands`);
    console.log('4. Certifique-se de que o bot está online no Discord Developer Portal');
    process.exit(1);
});

// Manipular encerramento
process.on('SIGINT', () => {
    console.log('\n🔴 Desconectando bot...');
    client.destroy();
    db.close();
    process.exit(0);
});