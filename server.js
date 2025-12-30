require("dotenv").config();
const express = require("express");
const session = require("express-session");
const axios = require("axios");
//const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const app = express();
//const db = new sqlite3.Database("./whitelist.db");

/* ================= DB ================= */

db.serialize(() => {
    // Criar tabela se não existir
    db.run(`
        CREATE TABLE IF NOT EXISTS formularios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            discord_id TEXT UNIQUE,
            discord_name TEXT,
            discord_avatar TEXT,
            roblox TEXT,
            idade TEXT,
            experiencia TEXT,
            status TEXT DEFAULT 'pendente',
            motivo_reprova TEXT DEFAULT '',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `, (err) => {
        if (err) {
            console.error("❌ Erro ao criar tabela:", err.message);
        } else {
            console.log("✅ Tabela 'formularios' verificada/criada");
        }
    });
    
    // Criar trigger para updated_at
    db.run(`
        CREATE TRIGGER IF NOT EXISTS update_timestamp 
        AFTER UPDATE ON formularios
        BEGIN
            UPDATE formularios 
            SET updated_at = CURRENT_TIMESTAMP 
            WHERE id = NEW.id;
        END;
    `, (err) => {
        if (!err) {
            console.log("✅ Trigger para updated_at criada");
        }
    });
});

/* ================= MIDDLEWARE ================= */

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: process.env.SESSION_SECRET || "secret-session-cidade-alta",
    resave: false,
    saveUninitialized: false,
    cookie: { 
        maxAge: 86400000,
        secure: false,
        httpOnly: true
    }
}));
app.use(express.static(path.join(__dirname, "public")));

/* ================= AUTH ================= */

function auth(req, res, next) {
    if (!req.session.user) {
        return res.status(401).json({ error: "Login necessário" });
    }
    next();
}

function isAdmin(req, res, next) {
    const ADMINS = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',') : [];
    if (!req.session.user || !ADMINS.includes(req.session.user.id)) {
        return res.status(403).json({ error: "Acesso negado. Apenas administradores." });
    }
    next();
}

/* ================= LOGIN DISCORD ================= */

app.get("/login", (req, res) => {
    const redirectUri = process.env.REDIRECT_URI || "https://cidade-alta-wl.vercel.app/callback";
    const url = `https://discord.com/oauth2/authorize?client_id=${process.env.DISCORD_CLIENT_ID}&response_type=code&scope=identify&redirect_uri=${encodeURIComponent(redirectUri)}`;
    res.redirect(url);
});

app.get("/callback", async (req, res) => {
    try {
        const redirectUri = process.env.REDIRECT_URI || "https://cidade-alta-wl.vercel.app/callback";
        
        const tokenResponse = await axios.post(
            "https://discord.com/api/oauth2/token",
            new URLSearchParams({
                client_id: process.env.DISCORD_CLIENT_ID,
                client_secret: process.env.DISCORD_CLIENT_SECRET,
                grant_type: "authorization_code",
                code: req.query.code,
                redirect_uri: redirectUri
            }),
            { 
                headers: { 
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Accept-Encoding": "application/json"
                } 
            }
        );

        const userResponse = await axios.get("https://discord.com/api/users/@me", {
            headers: { 
                Authorization: `Bearer ${tokenResponse.data.access_token}`,
                "Accept-Encoding": "application/json"
            }
        });

        const userData = userResponse.data;
        const adminIds = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',') : [];
        
        req.session.user = {
            id: userData.id,
            username: userData.username,
            avatar: userData.avatar,
            discriminator: userData.discriminator,
            isAdmin: adminIds.includes(userData.id)
        };

        console.log(`✅ Login realizado: ${userData.username} (${userData.id})`);
        res.redirect("/dashboard");

    } catch (error) {
        console.error("❌ Erro no login:", error.response?.data || error.message);
        res.redirect("/?error=login_failed");
    }
});

app.get("/me", auth, (req, res) => {
    db.get(
        `SELECT * FROM formularios WHERE discord_id = ?`,
        [req.session.user.id],
        (err, form) => {
            if (err) {
                console.error("❌ Erro ao buscar formulário:", err);
                return res.status(500).json({ error: "Erro no servidor" });
            }
            
            const userData = {
                ...req.session.user,
                hasForm: !!form,
                formStatus: form ? form.status : null,
                robloxName: form ? form.roblox : null,
                formId: form ? form.id : null
            };
            
            res.json(userData);
        }
    );
});

/* ================= FORM ================= */

app.post("/form", auth, (req, res) => {
    const { roblox, idade, experiencia } = req.body;
    const userId = req.session.user.id;
    const username = req.session.user.username;

    console.log(`📝 Tentativa de formulário de: ${username} (${userId})`);

    // Validações
    if (!roblox || !idade || !experiencia) {
        return res.status(400).json({ error: "Preencha todos os campos" });
    }

    if (idade < 13 || idade > 99) {
        return res.status(400).json({ error: "Idade deve ser entre 13 e 99 anos" });
    }

    if (experiencia.length < 100) {
        return res.status(400).json({ error: "A experiência deve ter no mínimo 100 caracteres" });
    }

    if (experiencia.length > 5000) {
        return res.status(400).json({ error: "A experiência deve ter no máximo 5000 caracteres" });
    }

    // Verificar se já tem formulário
    db.get(
        `SELECT id, status FROM formularios WHERE discord_id = ?`,
        [userId],
        (err, existingForm) => {
            if (err) {
                console.error("❌ Erro ao verificar formulário:", err);
                return res.status(500).json({ error: "Erro no servidor" });
            }

            if (existingForm) {
                if (existingForm.status === 'pendente') {
                    return res.status(400).json({ 
                        error: "Você já tem um formulário pendente de análise. Aguarde a resposta." 
                    });
                }
                
                if (existingForm.status === 'aprovado') {
                    return res.status(400).json({ 
                        error: "Seu formulário já foi APROVADO! Você não pode enviar outro." 
                    });
                }
                
                // Se foi reprovado, atualiza o existente
                if (existingForm.status === 'reprovado') {
                    db.run(
                        `UPDATE formularios SET 
                            roblox = ?, 
                            idade = ?, 
                            experiencia = ?, 
                            status = 'pendente',
                            motivo_reprova = '',
                            updated_at = CURRENT_TIMESTAMP
                         WHERE discord_id = ?`,
                        [roblox, idade, experiencia, userId],
                        function(err) {
                            if (err) {
                                console.error("❌ Erro ao atualizar formulário:", err);
                                return res.status(500).json({ error: "Erro ao atualizar formulário" });
                            }
                            
                            console.log(`✅ Formulário #${this.lastID} reenviado por ${username}`);
                            res.json({ 
                                ok: true, 
                                message: "Formulário reenviado com sucesso! Aguarde a nova análise.",
                                formId: existingForm.id 
                            });
                        }
                    );
                    return;
                }
            }

            // Novo formulário
            db.run(
                `INSERT INTO formularios (discord_id, discord_name, discord_avatar, roblox, idade, experiencia)
                 VALUES (?,?,?,?,?,?)`,
                [userId, username, req.session.user.avatar, roblox, idade, experiencia],
                function(err) {
                    if (err) {
                        if (err.message.includes('UNIQUE constraint failed')) {
                            return res.status(400).json({ 
                                error: "Você já tem um formulário cadastrado." 
                            });
                        }
                        console.error("❌ Erro ao salvar formulário:", err);
                        return res.status(500).json({ error: "Erro ao salvar formulário" });
                    }
                    
                    console.log(`✅ Novo formulário #${this.lastID} de ${username}`);
                    res.json({ 
                        ok: true, 
                        message: "Formulário enviado com sucesso! Aguarde a análise.",
                        formId: this.lastID 
                    });
                }
            );
        }
    );
});

/* ================= FORM DATA ================= */

app.get("/form/data", auth, (req, res) => {
    db.get(
        `SELECT * FROM formularios WHERE discord_id = ?`,
        [req.session.user.id],
        (err, form) => {
            if (err) {
                console.error("❌ Erro ao buscar dados do formulário:", err);
                return res.status(500).json({ error: "Erro no servidor" });
            }
            
            if (!form) {
                return res.json({ hasForm: false });
            }
            
            res.json({
                hasForm: true,
                form: {
                    id: form.id,
                    roblox: form.roblox,
                    idade: form.idade,
                    experiencia: form.experiencia,
                    status: form.status,
                    motivo_reprova: form.motivo_reprova || '',
                    created_at: form.created_at,
                    updated_at: form.updated_at
                }
            });
        }
    );
});

/* ================= DASHBOARD ================= */

app.get("/dashboard", auth, (req, res) => {
    res.sendFile(path.join(__dirname, "public", "dashboard.html"));
});

app.get("/admin", isAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, "public", "admin.html"));
});

/* ================= ADMIN API ================= */

app.get("/admin/forms", isAdmin, (req, res) => {
    const status = req.query.status || 'pendente';
    const limit = parseInt(req.query.limit) || 50;
    
    let query = `SELECT * FROM formularios`;
    let params = [];
    
    if (status !== 'all') {
        query += ` WHERE status = ?`;
        params.push(status);
    }
    
    query += ` ORDER BY created_at DESC LIMIT ?`;
    params.push(limit);
    
    db.all(query, params, (err, rows) => {
        if (err) {
            console.error("❌ Erro ao buscar formulários:", err);
            return res.status(500).json({ error: "Erro ao buscar formulários" });
        }
        res.json(rows);
    });
});

app.post("/admin/action", isAdmin, (req, res) => {
    const { id, action, motivo } = req.body;
    
    if (!['aprovado', 'reprovado'].includes(action)) {
        return res.status(400).json({ error: "Ação inválida" });
    }

    if (action === 'reprovado' && (!motivo || motivo.trim().length < 5)) {
        return res.status(400).json({ error: "Motivo da reprovação é obrigatório (mínimo 5 caracteres)" });
    }

    db.run(
        `UPDATE formularios SET status = ?, motivo_reprova = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [action, motivo || '', id],
        function(err) {
            if (err) {
                console.error("❌ Erro ao atualizar status:", err);
                return res.status(500).json({ error: "Erro ao atualizar status" });
            }
            
            console.log(`✅ Formulário #${id} ${action} ${motivo ? 'com motivo' : ''}`);
            res.json({ 
                ok: true, 
                message: `Formulário ${action} com sucesso`,
                changes: this.changes 
            });
        }
    );
});

app.get("/admin/stats", isAdmin, (req, res) => {
    db.all(
        `SELECT status, COUNT(*) as count FROM formularios GROUP BY status`,
        (err, rows) => {
            if (err) {
                console.error("❌ Erro ao buscar estatísticas:", err);
                return res.status(500).json({ error: "Erro ao buscar estatísticas" });
            }
            res.json(rows);
        }
    );
});

app.get("/admin/form/:id", isAdmin, (req, res) => {
    const id = req.params.id;
    
    db.get(
        `SELECT * FROM formularios WHERE id = ?`,
        [id],
        (err, form) => {
            if (err) {
                console.error("❌ Erro ao buscar formulário:", err);
                return res.status(500).json({ error: "Erro ao buscar formulário" });
            }
            
            if (!form) {
                return res.status(404).json({ error: "Formulário não encontrado" });
            }
            
            res.json(form);
        }
    );
});

/* ================= SYSTEM STATUS ================= */

app.get("/api/status", (req, res) => {
    const botStatus = {
        online: true,
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        timestamp: new Date().toISOString(),
        version: "1.0.0",
        system: "Cidade Alta RP - St Studios"
    };
    
    // Contar formulários para estatísticas rápidas
    db.get(`SELECT COUNT(*) as total FROM formularios`, (err, row) => {
        if (!err && row) {
            botStatus.totalForms = row.total;
        }
        res.json(botStatus);
    });
});

/* ================= LOGOUT ================= */

app.post("/logout", (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error("❌ Erro ao fazer logout:", err);
            return res.status(500).json({ error: "Erro ao fazer logout" });
        }
        res.json({ ok: true });
    });
});

/* ================= HEALTH CHECK ================= */

app.get("/health", (req, res) => {
    res.json({ 
        status: "online", 
        timestamp: new Date().toISOString(),
        database: "connected"
    });
});


/* ================= 404 HANDLER ================= */

app.use((req, res) => {
    if (req.accepts('html')) {
        res.status(404).sendFile(path.join(__dirname, "public", "404.html"));
    } else if (req.accepts('json')) {
        res.status(404).json({ error: "Página não encontrada" });
    } else {
        res.status(404).type('txt').send("404 - Página não encontrada");
    }
});

/* ================= ERROR HANDLER ================= */

app.use((err, req, res, next) => {
    console.error("❌ Erro no servidor:", err.stack);
    res.status(500).json({ 
        error: "Erro interno do servidor",
        message: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

/* ================= SERVER ================= */

/* ================= SERVER ================= */

const PORT = process.env.PORT || 3000;

// Para Vercel, não especifique HOST
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    console.log(`📊 Sistema Cidade Alta RP - St Studios`);
    console.log(`👤 Admin IDs: ${process.env.ADMIN_IDS || 'Não configurado'}`);
    console.log(`🤖 Bot Client ID: ${process.env.DISCORD_CLIENT_ID || 'Não configurado'}`);
    console.log(`📁 Pasta pública: ${path.join(__dirname, "public")}`);
});

// Export para Vercel
module.exports = app;

app.get("/api/roblox/whitelist", (req, res) => {
    if (req.headers.authorization !== process.env.ROBLOX_API_KEY) {
        return res.status(403).json({ error: "Unauthorized" });
    }

    const userId = req.query.userId;
    // consulta banco...
});




