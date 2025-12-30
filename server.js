require("dotenv").config();
const express = require("express");
const session = require("express-session");
const axios = require("axios");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const app = express();

/* ================= SUPABASE CONFIG ================= */

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("❌ SUPABASE_URL e SUPABASE_KEY são obrigatórios no .env");
    console.log("💡 Crie conta em: https://supabase.com");
}

const supabase = createClient(supabaseUrl, supabaseKey);

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

app.get("/me", auth, async (req, res) => {
    try {
        const { data: form, error } = await supabase
            .from('formularios')
            .select('*')
            .eq('discord_id', req.session.user.id)
            .single();

        if (error && error.code !== 'PGRST116') { // PGRST116 = no rows
            console.error("❌ Erro ao buscar formulário:", error);
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
    } catch (error) {
        console.error("❌ Erro:", error);
        res.status(500).json({ error: "Erro no servidor" });
    }
});

/* ================= FORM SUBMISSION ================= */

app.post("/form", auth, async (req, res) => {
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

    try {
        // Verificar se já tem formulário
        const { data: existingForm, error: fetchError } = await supabase
            .from('formularios')
            .select('id, status')
            .eq('discord_id', userId)
            .single();

        if (fetchError && fetchError.code !== 'PGRST116') {
            console.error("❌ Erro ao verificar formulário:", fetchError);
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
                const { data: updated, error: updateError } = await supabase
                    .from('formularios')
                    .update({
                        roblox,
                        idade,
                        experiencia,
                        status: 'pendente',
                        motivo_reprova: '',
                        updated_at: new Date().toISOString()
                    })
                    .eq('discord_id', userId)
                    .select()
                    .single();

                if (updateError) {
                    console.error("❌ Erro ao atualizar formulário:", updateError);
                    return res.status(500).json({ error: "Erro ao atualizar formulário" });
                }
                
                console.log(`✅ Formulário #${updated.id} reenviado por ${username}`);
                return res.json({ 
                    ok: true, 
                    message: "Formulário reenviado com sucesso! Aguarde a nova análise.",
                    formId: updated.id 
                });
            }
        }

        // Novo formulário
        const { data: newForm, error: insertError } = await supabase
            .from('formularios')
            .insert({
                discord_id: userId,
                discord_name: username,
                discord_avatar: req.session.user.avatar || null,
                roblox,
                idade,
                experiencia,
                status: 'pendente',
                motivo_reprova: '',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            .select()
            .single();

        if (insertError) {
            if (insertError.code === '23505') { // Unique violation
                return res.status(400).json({ 
                    error: "Você já tem um formulário cadastrado." 
                });
            }
            console.error("❌ Erro ao salvar formulário:", insertError);
            return res.status(500).json({ error: "Erro ao salvar formulário" });
        }
        
        console.log(`✅ Novo formulário #${newForm.id} de ${username}`);
        res.json({ 
            ok: true, 
            message: "Formulário enviado com sucesso! Aguarde a análise.",
            formId: newForm.id 
        });

    } catch (error) {
        console.error("❌ Erro:", error);
        res.status(500).json({ error: "Erro no servidor" });
    }
});

app.get("/form/data", auth, async (req, res) => {
    try {
        const { data: form, error } = await supabase
            .from('formularios')
            .select('*')
            .eq('discord_id', req.session.user.id)
            .single();

        if (error && error.code !== 'PGRST116') {
            console.error("❌ Erro ao buscar dados do formulário:", error);
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
    } catch (error) {
        console.error("❌ Erro:", error);
        res.status(500).json({ error: "Erro no servidor" });
    }
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

app.get("/admin/forms", isAdmin, async (req, res) => {
    const status = req.query.status || 'pendente';
    const limit = parseInt(req.query.limit) || 50;
    
    try {
        let query = supabase
            .from('formularios')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(limit);

        if (status !== 'all') {
            query = query.eq('status', status);
        }

        const { data: forms, error } = await query;

        if (error) {
            console.error("❌ Erro ao buscar formulários:", error);
            return res.status(500).json({ error: "Erro ao buscar formulários" });
        }
        
        res.json(forms || []);
    } catch (error) {
        console.error("❌ Erro:", error);
        res.status(500).json({ error: "Erro no servidor" });
    }
});

app.post("/admin/action", isAdmin, async (req, res) => {
    const { id, action, motivo } = req.body;
    
    if (!['aprovado', 'reprovado'].includes(action)) {
        return res.status(400).json({ error: "Ação inválida" });
    }

    if (action === 'reprovado' && (!motivo || motivo.trim().length < 5)) {
        return res.status(400).json({ error: "Motivo da reprovação é obrigatório (mínimo 5 caracteres)" });
    }

    try {
        const { data: updated, error } = await supabase
            .from('formularios')
            .update({
                status: action,
                motivo_reprova: action === 'reprovado' ? motivo : '',
                updated_at: new Date().toISOString()
            })
            .eq('id', id)
            .select()
            .single();

        if (error) {
            console.error("❌ Erro ao atualizar status:", error);
            return res.status(500).json({ error: "Erro ao atualizar status" });
        }
        
        if (!updated) {
            return res.status(404).json({ error: "Formulário não encontrado" });
        }
        
        console.log(`✅ Formulário #${id} ${action}`);
        res.json({ 
            ok: true, 
            message: `Formulário ${action} com sucesso`,
            changes: 1 
        });
    } catch (error) {
        console.error("❌ Erro:", error);
        res.status(500).json({ error: "Erro no servidor" });
    }
});

app.get("/admin/stats", isAdmin, async (req, res) => {
    try {
        const { data: stats, error } = await supabase
            .from('formularios')
            .select('status');

        if (error) {
            console.error("❌ Erro ao buscar estatísticas:", error);
            return res.status(500).json({ error: "Erro ao buscar estatísticas" });
        }

        const counts = {
            pendente: 0,
            aprovado: 0,
            reprovado: 0,
            total: stats?.length || 0
        };

        stats?.forEach(form => {
            if (counts[form.status] !== undefined) {
                counts[form.status]++;
            }
        });

        const result = Object.entries(counts)
            .filter(([status]) => status !== 'total')
            .map(([status, count]) => ({ status, count }));

        result.push({ status: 'total', count: counts.total });
        
        res.json(result);
    } catch (error) {
        console.error("❌ Erro:", error);
        res.status(500).json({ error: "Erro no servidor" });
    }
});

app.get("/admin/form/:id", isAdmin, async (req, res) => {
    try {
        const { data: form, error } = await supabase
            .from('formularios')
            .select('*')
            .eq('id', req.params.id)
            .single();

        if (error) {
            console.error("❌ Erro ao buscar formulário:", error);
            return res.status(500).json({ error: "Erro ao buscar formulário" });
        }
        
        if (!form) {
            return res.status(404).json({ error: "Formulário não encontrado" });
        }
        
        res.json(form);
    } catch (error) {
        console.error("❌ Erro:", error);
        res.status(500).json({ error: "Erro no servidor" });
    }
});

/* ================= SYSTEM STATUS ================= */

app.get("/api/status", async (req, res) => {
    try {
        const { count, error } = await supabase
            .from('formularios')
            .select('*', { count: 'exact', head: true });

        if (error) {
            console.error("❌ Erro ao contar formulários:", error);
        }

        res.json({
            online: true,
            uptime: process.uptime(),
            timestamp: new Date().toISOString(),
            version: "1.0.0",
            system: "Cidade Alta RP - St Studios",
            database: "supabase",
            totalForms: count || 0
        });
    } catch (error) {
        console.error("❌ Erro:", error);
        res.status(500).json({ error: "Erro no servidor" });
    }
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

app.get("/health", async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('formularios')
            .select('id')
            .limit(1);

        res.json({ 
            status: "online", 
            timestamp: new Date().toISOString(),
            database: error ? "error" : "connected",
            test_query: data ? "success" : "no_data"
        });
    } catch (error) {
        res.json({ 
            status: "online", 
            timestamp: new Date().toISOString(),
            database: "error",
            error: error.message
        });
    }
});

/* ================= ROBLOX API ================= */

app.get("/api/roblox/whitelist", async (req, res) => {
    if (req.headers.authorization !== process.env.ROBLOX_API_KEY) {
        return res.status(403).json({ error: "Unauthorized" });
    }

    const userId = req.query.userId;
    
    try {
        const { data: form, error } = await supabase
            .from('formularios')
            .select('*')
            .or(`discord_id.eq.${userId},roblox.ilike.%${userId}%`)
            .single();

        if (error && error.code !== 'PGRST116') {
            console.error("❌ Erro ao buscar whitelist:", error);
            return res.status(500).json({ error: "Database error" });
        }
        
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
    } catch (error) {
        console.error("❌ Erro:", error);
        res.status(500).json({ error: "Server error" });
    }
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
        console.log(`🗄️  Banco: Supabase (PostgreSQL)`);
        console.log(`👤 Admin IDs: ${process.env.ADMIN_IDS || 'Não configurado'}`);
    });
}
