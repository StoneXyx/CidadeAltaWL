require("dotenv").config();
const express = require("express");
const session = require("express-session");
const axios = require("axios");
const path = require("path");

const app = express();

/* ================= BANCO EM MEMÓRIA ================= */

const formularios = [];
let formIdCounter = 1;

// Funções para simular SQLite
const db = {
    // Buscar formulário por Discord ID
    getFormByDiscordId: (discordId) => {
        return formularios.find(f => f.discord_id === discordId);
    },
    
    // Buscar formulário por ID
    getFormById: (id) => {
        return formularios.find(f => f.id === parseInt(id));
    },
    
    // Buscar todos os formulários (com filtro de status)
    getAllForms: (status = null) => {
        if (status && status !== 'all') {
            return formularios.filter(f => f.status === status);
        }
        return formularios;
    },
    
    // Inserir novo formulário
    insertForm: (form) => {
        const newForm = {
            id: formIdCounter++,
            ...form,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };
        formularios.push(newForm);
        return newForm;
    },
    
    // Atualizar formulário
    updateForm: (discordId, updates) => {
        const index = formularios.findIndex(f => f.discord_id === discordId);
        if (index >= 0) {
            formularios[index] = {
                ...formularios[index],
                ...updates,
                updated_at: new Date().toISOString()
            };
            return formularios[index];
        }
        return null;
    },
    
    // Atualizar por ID (admin)
    updateFormById: (id, updates) => {
        const index = formularios.findIndex(f => f.id === parseInt(id));
        if (index >= 0) {
            formularios[index] = {
                ...formularios[index],
                ...updates,
                updated_at: new Date().toISOString()
            };
            return formularios[index];
        }
        return null;
    },
    
    // Estatísticas
    getStats: () => {
        const stats = {
            pendente: 0,
            aprovado: 0,
            reprovado: 0,
            total: formularios.length
        };
        
        formularios.forEach(form => {
            if (stats[form.status] !== undefined) {
                stats[form.status]++;
            }
        });
        
        return Object.entries(stats).map(([status, count]) => ({ status, count }));
    }
};

/* ================= MIDDLEWARE ================= */

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));
app.use(session({
    secret: process.env.SESSION_SECRET || "secret-session-cidade-alta",
    resave: false,
    saveUninitialized: false,
    cookie: { 
        maxAge: 86400000,
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        sameSite: 'lax'
    }
}));

/* ================= AUTH ================= */

function auth(req, res, next) {
    if (!req.session.user) {
        return res.status(401).json({ error: "Login necessário" });
    }
    next();
}

function isAdmin(req, res, next) {
    const ADMINS = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',').map(id => id.trim()) : [];
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
                    "Content-Type": "application/x-www-form-urlencoded"
                } 
            }
        );

        const userResponse = await axios.get("https://discord.com/api/users/@me", {
            headers: { 
                Authorization: `Bearer ${tokenResponse.data.access_token}`
            }
        });

        const userData = userResponse.data;
        const adminIds = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',').map(id => id.trim()) : [];
        
        req.session.user = {
            id: userData.id,
            username: userData.username,
            avatar: userData.avatar,
            discriminator: userData.discriminator,
            isAdmin: adminIds.includes(userData.id)
        };

        console.log(`✅ Login: ${userData.username} (${userData.id})`);
        res.redirect("/dashboard");

    } catch (error) {
        console.error("❌ Erro no login:", error.message);
        res.redirect("/?error=login_failed");
    }
});

/* ================= USER API ================= */

app.get("/me", auth, (req, res) => {
    const form = db.getFormByDiscordId(req.session.user.id);
    
    const userData = {
        ...req.session.user,
        hasForm: !!form,
        formStatus: form ? form.status : null,
        robloxName: form ? form.roblox : null,
        formId: form ? form.id : null
    };
    
    res.json(userData);
});

/* ================= FORM SUBMISSION ================= */

app.post("/form", auth, (req, res) => {
    const { roblox, idade, experiencia } = req.body;
    const userId = req.session.user.id;
    const username = req.session.user.username;

    console.log(`📝 Formulário de: ${username} (${userId})`);

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
    const existingForm = db.getFormByDiscordId(userId);

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
            const updated = db.updateForm(userId, {
                roblox,
                idade,
                experiencia,
                status: 'pendente',
                motivo_reprova: ''
            });
            
            console.log(`✅ Formulário #${updated.id} reenviado por ${username}`);
            return res.json({ 
                ok: true, 
                message: "Formulário reenviado com sucesso! Aguarde a nova análise.",
                formId: updated.id 
            });
        }
    }

    // Novo formulário
    const newForm = db.insertForm({
        discord_id: userId,
        discord_name: username,
        discord_avatar: req.session.user.avatar || null,
        roblox,
        idade,
        experiencia,
        status: 'pendente',
        motivo_reprova: ''
    });
    
    console.log(`✅ Novo formulário #${newForm.id} de ${username}`);
    res.json({ 
        ok: true, 
        message: "Formulário enviado com sucesso! Aguarde a análise.",
        formId: newForm.id 
    });
});

app.get("/form/data", auth, (req, res) => {
    const form = db.getFormByDiscordId(req.session.user.id);
    
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
});

/* ================= PAGES ================= */

app.get("/dashboard", auth, (req, res) => {
    res.sendFile(path.join(__dirname, "public", "dashboard.html"));
});

app.get("/admin", isAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

/* ================= ADMIN API ================= */

app.get("/admin/forms", isAdmin, (req, res) => {
    const status = req.query.status || 'pendente';
    const limit = parseInt(req.query.limit) || 50;
    
    let forms = db.getAllForms(status === 'all' ? null : status);
    
    // Ordenar por data (mais recente primeiro) e limitar
    forms = forms
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, limit);
    
    res.json(forms);
});

app.post("/admin/action", isAdmin, (req, res) => {
    const { id, action, motivo } = req.body;
    
    if (!['aprovado', 'reprovado'].includes(action)) {
        return res.status(400).json({ error: "Ação inválida" });
    }

    if (action === 'reprovado' && (!motivo || motivo.trim().length < 5)) {
        return res.status(400).json({ error: "Motivo da reprovação é obrigatório (mínimo 5 caracteres)" });
    }

    const updatedForm = db.updateFormById(id, {
        status: action,
        motivo_reprova: action === 'reprovado' ? motivo : ''
    });
    
    if (!updatedForm) {
        return res.status(404).json({ error: "Formulário não encontrado" });
    }
    
    console.log(`✅ Formulário #${id} ${action}`);
    res.json({ 
        ok: true, 
        message: `Formulário ${action} com sucesso`,
        form: updatedForm
    });
});

app.get("/admin/stats", isAdmin, (req, res) => {
    const stats = db.getStats();
    res.json(stats);
});

app.get("/admin/form/:id", isAdmin, (req, res) => {
    const form = db.getFormById(req.params.id);
    
    if (!form) {
        return res.status(404).json({ error: "Formulário não encontrado" });
    }
    
    res.json(form);
});

/* ================= SYSTEM STATUS ================= */

app.get("/api/status", (req, res) => {
    const stats = db.getStats();
    const totalForms = formularios.length;
    
    res.json({
        online: true,
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        version: "1.0.0",
        system: "Cidade Alta RP - St Studios",
        stats: {
            total: totalForms,
            pendente: stats.find(s => s.status === 'pendente')?.count || 0,
            aprovado: stats.find(s => s.status === 'aprovado')?.count || 0,
            reprovado: stats.find(s => s.status === 'reprovado')?.count || 0
        }
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
        forms: formularios.length,
        memory: formularios.length > 0 ? "em_memoria" : "vazio"
    });
});

/* ================= ROBLOX API (para o bot) ================= */

app.get("/api/roblox/whitelist", (req, res) => {
    if (req.headers.authorization !== process.env.ROBLOX_API_KEY) {
        return res.status(403).json({ error: "Unauthorized" });
    }

    const userId = req.query.userId;
    const form = formularios.find(f => 
        f.discord_id === userId || 
        f.roblox?.toLowerCase() === userId?.toLowerCase()
    );
    
    if (!form) {
        return res.json({ whitelisted: false });
    }
    
    res.json({
        whitelisted: form.status === 'aprovado',
        status: form.status,
        roblox: form.roblox,
        discord_id: form.discord_id,
        discord_name: form.discord_name
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
    console.error("❌ Erro no servidor:", err.message);
    res.status(500).json({ 
        error: "Erro interno do servidor",
        message: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

/* ================= EXPORT PARA VERCEL ================= */

module.exports = app;

/* ================= LOCAL DEVELOPMENT ================= */

if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
        console.log(`📊 Sistema Cidade Alta RP - St Studios`);
        console.log(`📁 Formulários em memória: ${formularios.length}`);
        console.log(`👤 Admin IDs: ${process.env.ADMIN_IDS || 'Não configurado'}`);
    });
}
