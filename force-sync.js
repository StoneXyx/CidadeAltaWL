// force-sync.js
require('dotenv').config();
const { REST, Routes } = require('discord.js');

console.log('🚀 FORÇANDO SINCRONIZAÇÃO DE COMANDOS SLASH');
console.log('='.repeat(50));

// Verificar configuração
if (!process.env.DISCORD_BOT_TOKEN) {
    console.error('❌ ERRO: DISCORD_BOT_TOKEN não encontrado no .env');
    process.exit(1);
}

if (!process.env.DISCORD_CLIENT_ID) {
    console.error('❌ ERRO: DISCORD_CLIENT_ID não encontrado no .env');
    process.exit(1);
}

console.log(`✅ Client ID: ${process.env.DISCORD_CLIENT_ID}`);
console.log(`✅ Guild ID: ${process.env.GUILD_ID || 'Não definido (comandos globais)'}`);

const commands = [
    {
        name: 'whitelist',
        description: '📋 Sistema de whitelist Cidade Alta RP',
        options: [
            {
                type: 1, // SUB_COMMAND
                name: 'pendentes',
                description: 'Ver formulários pendentes de aprovação'
            },
            {
                type: 1,
                name: 'stats',
                description: 'Ver estatísticas das whitelists'
            },
            {
                type: 1,
                name: 'buscar',
                description: 'Buscar formulário por ID, Discord ou Roblox',
                options: [
                    {
                        type: 3, // STRING
                        name: 'query',
                        description: 'ID, Discord ID ou Nick Roblox',
                        required: true
                    }
                ]
            },
            {
                type: 1,
                name: 'revisar',
                description: 'Revisar formulário específico',
                options: [
                    {
                        type: 3,
                        name: 'id',
                        description: 'ID do formulário',
                        required: true
                    }
                ]
            },
            {
                type: 1,
                name: 'aprovar',
                description: 'Aprovar formulário diretamente',
                options: [
                    {
                        type: 3,
                        name: 'id',
                        description: 'ID do formulário',
                        required: true
                    }
                ]
            },
            {
                type: 1,
                name: 'reprovar',
                description: 'Reprovar formulário com motivo',
                options: [
                    {
                        type: 3,
                        name: 'id',
                        description: 'ID do formulário',
                        required: true
                    },
                    {
                        type: 3,
                        name: 'motivo',
                        description: 'Motivo da reprovação',
                        required: true
                    }
                ]
            },
            {
                type: 1,
                name: 'help',
                description: 'Mostra ajuda sobre os comandos'
            }
        ]
    }
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);

(async () => {
    try {
        console.log('\n🔄 Iniciando sincronização...');
        
        // PRIMEIRO: Limpar comandos antigos
        console.log('🗑️  Limpando comandos antigos...');
        
        try {
            // Limpar comandos globais
            await rest.put(
                Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
                { body: [] }
            );
            console.log('✅ Comandos globais removidos');
            
            // Limpar comandos do servidor específico
            if (process.env.GUILD_ID) {
                await rest.put(
                    Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.GUILD_ID),
                    { body: [] }
                );
                console.log('✅ Comandos do servidor removidos');
            }
            
            console.log('⏳ Aguardando 3 segundos...');
            await new Promise(resolve => setTimeout(resolve, 3000));
            
        } catch (cleanError) {
            console.log('ℹ️  Não havia comandos para limpar ou erro:', cleanError.message);
        }
        
        // SEGUNDO: Registrar novos comandos
        console.log('\n📝 Registrando novos comandos...');
        
        // Comandos GLOBAIS
        const globalCommands = await rest.put(
            Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
            { body: commands }
        );
        console.log(`✅ ${globalCommands.length} comandos registrados GLOBALMENTE`);
        console.log('   ⏰ Pode levar até 1 hora para aparecer em todos servidores');
        
        // Comandos no SERVIDOR ESPECÍFICO
        if (process.env.GUILD_ID) {
            try {
                const guildCommands = await rest.put(
                    Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.GUILD_ID),
                    { body: commands }
                );
                console.log(`✅ ${guildCommands.length} comandos registrados no servidor`);
                console.log('   ⚡ Aparecerão IMEDIATAMENTE neste servidor!');
            } catch (guildError) {
                console.warn(`⚠️  Não foi possível registrar no servidor: ${guildError.message}`);
                console.log('💡 Verifique se o bot está no servidor e se o GUILD_ID está correto');
            }
        }
        
        console.log('\n' + '='.repeat(50));
        console.log('🎉 SINCRONIZAÇÃO CONCLUÍDA!');
        console.log('\n📋 COMANDOS DISPONÍVEIS:');
        console.log('   /whitelist pendentes');
        console.log('   /whitelist stats');
        console.log('   /whitelist buscar [query]');
        console.log('   /whitelist revisar [id]');
        console.log('   /whitelist aprovar [id]');
        console.log('   /whitelist reprovar [id] [motivo]');
        console.log('   /whitelist help');
        console.log('\n💡 DICAS:');
        console.log('1. Reinicie o bot: node bot.js');
        console.log('2. No Discord, digite "/" para ver os comandos');
        console.log('3. Se não aparecer, tente:');
        console.log('   - Sair e entrar no servidor');
        console.log('   - Reiniciar o Discord');
        console.log('   - Usar em um canal diferente');
        console.log('\n🔄 Comando legado que SEMPRE funciona:');
        console.log('   !pendentes - Ver formulários pendentes');
        
    } catch (error) {
        console.error('\n❌ ERRO NA SINCRONIZAÇÃO:', error.message);
        
        if (error.code === 50001) {
            console.error('\n🔒 ERRO DE PERMISSÃO:');
            console.error('O bot não tem acesso ao servidor!');
            console.error('Convite correto (copie e cole no navegador):');
            console.error(`https://discord.com/api/oauth2/authorize?client_id=${process.env.DISCORD_CLIENT_ID}&permissions=8&scope=bot%20applications.commands`);
        }
        
        if (error.code === 10004) {
            console.error('\n🔍 GUILD_ID INCORRETO:');
            console.error('O GUILD_ID no .env está errado ou o bot não está no servidor!');
        }
        
        if (error.code === 50013) {
            console.error('\n🔒 PERMISSÕES INSUFICIENTES:');
            console.error('O bot precisa da permissão "Use Slash Commands"');
        }
    }
})();