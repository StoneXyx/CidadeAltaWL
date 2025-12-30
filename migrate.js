// migrate.js
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./whitelist.db');

console.log('🔄 Iniciando migração do banco de dados...');

db.serialize(() => {
    // Adicionar colunas que faltam
    const alterQueries = [
        "ALTER TABLE formularios ADD COLUMN motivo_reprova TEXT DEFAULT ''",
        "ALTER TABLE formularios ADD COLUMN discord_avatar TEXT",
        "ALTER TABLE formularios ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP"
    ];

    alterQueries.forEach((query, index) => {
        db.run(query, (err) => {
            if (err) {
                if (err.message.includes('duplicate column name')) {
                    console.log(`✅ Coluna já existe (${index + 1}/3)`);
                } else {
                    console.log(`⚠️  Erro na query ${index + 1}:`, err.message);
                }
            } else {
                console.log(`✅ Coluna adicionada (${index + 1}/3)`);
            }
        });
    });

    // Atualizar registros existentes
    db.run(`UPDATE formularios SET updated_at = created_at WHERE updated_at IS NULL`, (err) => {
        if (err) {
            console.log('⚠️  Erro ao atualizar timestamps:', err.message);
        } else {
            console.log('✅ Timestamps atualizados');
        }
    });

    // Verificar estrutura final
    db.all(`PRAGMA table_info(formularios)`, (err, columns) => {
        if (err) {
            console.error('Erro ao verificar estrutura:', err);
            return;
        }
        
        console.log('\n📊 Estrutura final da tabela:');
        console.log('='.repeat(50));
        columns.forEach(col => {
            console.log(`${col.name.padEnd(15)} ${col.type.padEnd(10)} ${col.notnull ? 'NOT NULL' : 'NULL'.padEnd(8)} ${col.dflt_value ? 'DEFAULT ' + col.dflt_value : ''}`);
        });
        console.log('='.repeat(50));
    });
});

db.close(() => {
    console.log('\n✅ Migração concluída!');
    console.log('🔄 Reinicie o servidor e o bot.');
});