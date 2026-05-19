import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import cors from "cors";
import "dotenv/config";
import { fileURLToPath } from "url";

const app = express();
const PORT = process.env.PORT || 3000;
const WHATSAPP_NUMBER = process.env.WHATSAPP_NUMBER || "5511967018540";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "1234";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pedidosPath = path.join(__dirname, "pedidos.json");
const analyticsPath = path.join(__dirname, "analytics.json");
const configPath = path.join(__dirname, "config.json");
const uploadsDir = path.join(__dirname, "uploads");

if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
if (!fs.existsSync(pedidosPath)) fs.writeFileSync(pedidosPath, "[]");
if (!fs.existsSync(analyticsPath)) fs.writeFileSync(analyticsPath, JSON.stringify({ visitas: [], eventos: [] }, null, 2));
if (!fs.existsSync(configPath)) fs.writeFileSync(configPath, JSON.stringify({ whatsappNotificacao: "" }, null, 2));

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(uploadsDir));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || ".jpg");
    const safe = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, safe);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) return cb(new Error("Envie uma imagem válida."));
    cb(null, true);
  }
});

function lerPedidos() {
  return JSON.parse(fs.readFileSync(pedidosPath, "utf8"));
}

function salvarPedidos(pedidos) {
  fs.writeFileSync(pedidosPath, JSON.stringify(pedidos, null, 2));
}



function lerConfig() {
  try { return JSON.parse(fs.readFileSync(configPath, "utf8")); }
  catch (e) { return { whatsappNotificacao: "" }; }
}

function salvarConfig(config) {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

function limparTelefoneBR(numero) {
  const limpo = String(numero || "").replace(/\D/g, "");
  if (!limpo) return "";
  return limpo.startsWith("55") ? limpo : "55" + limpo;
}

function calcularFaturamento(pedidos) {
  const valorBase = Number(process.env.PACKAGE_INSURANCE_VALUE || 29.9);
  const statusPagos = ["Pago", "Produzindo", "Pronto", "Saiu para entrega", "Entregue", "Finalizado"];
  const pagos = pedidos.filter(p => statusPagos.includes(p.status));
  return {
    valorBase,
    pedidosPagos: pagos.length,
    total: (pagos.length * valorBase).toFixed(2)
  };
}

function lerAnalytics() {
  try {
    return JSON.parse(fs.readFileSync(analyticsPath, "utf8"));
  } catch (e) {
    return { visitas: [], eventos: [] };
  }
}

function salvarAnalytics(data) {
  fs.writeFileSync(analyticsPath, JSON.stringify(data, null, 2));
}

function hojeISO() {
  return new Date().toISOString().slice(0, 10);
}

function mesmoDiaISO(dataISO, dia) {
  return String(dataISO || "").slice(0, 10) === dia;
}

function resumoAnalytics() {
  const data = lerAnalytics();
  const pedidos = lerPedidos();
  const hoje = hojeISO();

  const visitasHoje = data.visitas.filter(v => mesmoDiaISO(v.data, hoje)).length;
  const eventosHoje = data.eventos.filter(e => mesmoDiaISO(e.data, hoje));
  const pedidosHoje = pedidos.filter(p => {
    const partes = String(p.data || "").split(",")[0].split("/");
    if (partes.length !== 3) return false;
    const iso = `${partes[2]}-${partes[1].padStart(2, "0")}-${partes[0].padStart(2, "0")}`;
    return iso === hoje;
  }).length;

  const contar = (nome) => data.eventos.filter(e => e.nome === nome).length;
  const contarHoje = (nome) => eventosHoje.filter(e => e.nome === nome).length;

  return {
    visitasTotal: data.visitas.length,
    visitasHoje,
    eventosTotal: data.eventos.length,
    cliquesWhatsAppTotal: contar("whatsapp_click"),
    cliquesWhatsAppHoje: contarHoje("whatsapp_click"),
    fretesCalculadosTotal: contar("frete_calculado"),
    fretesCalculadosHoje: contarHoje("frete_calculado"),
    formulariosEnviadosTotal: contar("pedido_enviado"),
    formulariosEnviadosHoje: contarHoje("pedido_enviado"),
    pedidosTotal: pedidos.length,
    pedidosHoje,
    taxaConversao: data.visitas.length ? ((contar("pedido_enviado") / data.visitas.length) * 100).toFixed(1) : "0.0",
    faturamento: calcularFaturamento(pedidos)
  };
}

function limparCep(cep) {
  return String(cep || "").replace(/\D/g, "");
}

function freteTeste(cep) {
  const finalCep = Number(limparCep(cep).slice(-3) || 0);
  const base = 18.9 + (finalCep % 11);
  return [
    { id: "LOGGI_EXPRESS", nome: "Express", preco: (base + 4.9).toFixed(2), prazo: 2, empresa: "Loggi", teste: true },
    { id: "JET_STANDARD", nome: "Standard", preco: base.toFixed(2), prazo: 5, empresa: "J&T", teste: true },
    { id: "CORREIOS_SEDEX", nome: "SEDEX", preco: (base + 9.7).toFixed(2), prazo: 3, empresa: "Correios", teste: true }
  ];
}

app.get("/api/config", (req, res) => {
  res.json({ whatsapp: WHATSAPP_NUMBER });
});



app.get("/api/configuracoes", (req, res) => {
  const senha = req.query.senha || "";
  if (senha !== ADMIN_PASSWORD) return res.status(401).json({ erro: "Senha inválida." });
  res.json(lerConfig());
});

app.post("/api/configuracoes", (req, res) => {
  const senha = req.query.senha || "";
  if (senha !== ADMIN_PASSWORD) return res.status(401).json({ erro: "Senha inválida." });
  const atual = lerConfig();
  atual.whatsappNotificacao = limparTelefoneBR(req.body.whatsappNotificacao || "");
  salvarConfig(atual);
  res.json({ sucesso: true, config: atual });
});

app.post("/api/analytics", (req, res) => {
  try {
    const { tipo, pagina } = req.body || {};
    const data = lerAnalytics();
    const registro = {
      nome: String(tipo || "evento"),
      pagina: String(pagina || ""),
      data: new Date().toISOString(),
      ip: req.headers["x-forwarded-for"] || req.socket.remoteAddress || ""
    };

    if (registro.nome === "page_view") {
      data.visitas.push(registro);
    } else {
      data.eventos.push(registro);
    }

    // Evita arquivo gigante em hospedagem simples.
    data.visitas = data.visitas.slice(-5000);
    data.eventos = data.eventos.slice(-5000);

    salvarAnalytics(data);
    res.json({ sucesso: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ sucesso: false });
  }
});

app.get("/api/analytics/resumo", (req, res) => {
  const senha = req.query.senha || "";
  if (senha !== ADMIN_PASSWORD) return res.status(401).json({ erro: "Senha inválida." });
  res.json(resumoAnalytics());
});

app.delete("/api/pedidos/:id", (req, res) => {
  const senha = req.query.senha || "";
  if (senha !== ADMIN_PASSWORD) return res.status(401).json({ erro: "Senha inválida." });

  const pedidos = lerPedidos();
  const index = pedidos.findIndex(p => String(p.id) === String(req.params.id));
  if (index === -1) return res.status(404).json({ erro: "Pedido não encontrado." });

  const [pedido] = pedidos.splice(index, 1);

  if (pedido?.foto) {
    const fotoPath = path.join(__dirname, String(pedido.foto).replace(/^\/+/, ""));
    if (fotoPath.startsWith(uploadsDir) && fs.existsSync(fotoPath)) {
      try { fs.unlinkSync(fotoPath); } catch (e) { console.error("Erro ao apagar foto:", e); }
    }
  }

  salvarPedidos(pedidos);
  res.json({ sucesso: true });
});

app.post("/api/frete", async (req, res) => {
  try {
    const cepDestino = limparCep(req.body.cep);
    if (cepDestino.length !== 8) {
      return res.status(400).json({ sucesso: false, erro: "CEP inválido." });
    }

    const token = process.env.MELHOR_ENVIO_TOKEN;
    const cepOrigem = limparCep(process.env.MELHOR_ENVIO_FROM_CEP);

    if (!token || token.includes("cole_seu_token") || cepOrigem.length !== 8) {
      return res.json({
        sucesso: true,
        modoTeste: true,
        opcoes: freteTeste(cepDestino),
        aviso: "Modo teste: adicione MELHOR_ENVIO_TOKEN e MELHOR_ENVIO_FROM_CEP no .env para cotação real."
      });
    }

    const endpoint = process.env.MELHOR_ENVIO_SANDBOX === "true"
      ? "https://sandbox.melhorenvio.com.br/api/v2/me/shipment/calculate"
      : "https://www.melhorenvio.com.br/api/v2/me/shipment/calculate";

    // Payload real da cotação do Melhor Envio.
    // Produto padrão: 1 caneca 325ml embalada em caixa 12x12x12cm, 500g.
    // Caso altere embalagem/preço, ajuste os valores no .env.
    const altura = Number(process.env.PACKAGE_HEIGHT_CM || 12);
    const largura = Number(process.env.PACKAGE_WIDTH_CM || 12);
    const comprimento = Number(process.env.PACKAGE_LENGTH_CM || 12);
    const peso = Number(process.env.PACKAGE_WEIGHT_KG || 0.5);
    const valorDeclarado = Number(process.env.PACKAGE_INSURANCE_VALUE || 29.9);
    const services = String(process.env.MELHOR_ENVIO_SERVICES || "").trim();

    const payload = {
      from: { postal_code: cepOrigem },
      to: { postal_code: cepDestino },
      products: [
        {
          id: "caneca-325ml",
          width: largura,
          height: altura,
          length: comprimento,
          weight: peso,
          insurance_value: valorDeclarado,
          quantity: 1
        }
      ],
      options: {
        receipt: false,
        own_hand: false,
        collect: false
      }
    };

    if (services) {
      payload.services = services;
    }

    const resposta = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Accept": "application/json",
        "Content-Type": "application/json",
        "User-Agent": "Estampa Mundo (contato@estampamundo.local)"
      },
      body: JSON.stringify(payload)
    });

    const data = await resposta.json();

    if (!resposta.ok) {
      console.error("Erro Melhor Envio:", data);
      return res.status(500).json({
        sucesso: false,
        erro: "Não foi possível calcular o frete real agora. Verifique token, CEP de origem e configuração do Melhor Envio.",
        detalhe: data
      });
    }

    const lista = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);
    const todasOpcoes = lista
      .filter(item => !item.error && (item.price || item.custom_price))
      .map(item => ({
        id: item.id,
        nome: item.name || item.service_name || "Entrega",
        preco: String(item.custom_price || item.price),
        prazo: item.custom_delivery_time || item.delivery_time || "",
        empresa: item.company?.name || item.company?.title || "Transportadora",
        teste: false
      }));

    // Mostra somente as 3 opções desejadas no site:
    // 1) Loggi Express
    // 2) J&T/JET Standard
    // 3) Correios SEDEX
    const normalizar = (texto = "") =>
      String(texto)
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();

    const ehLoggiExpress = (opcao) => {
      const empresa = normalizar(opcao.empresa);
      const nome = normalizar(opcao.nome);
      return empresa.includes("loggi") && nome.includes("express");
    };

    const ehJetStandard = (opcao) => {
      const empresa = normalizar(opcao.empresa);
      const nome = normalizar(opcao.nome);
      const empresaJet = empresa.includes("jet") || empresa.includes("j t") || empresa.includes("j&t") || empresa.includes("jadlog");
      return empresaJet && nome.includes("standard");
    };

    const ehCorreiosSedex = (opcao) => {
      const empresa = normalizar(opcao.empresa);
      const nome = normalizar(opcao.nome);
      return empresa.includes("correios") && nome.includes("sedex");
    };

    const escolherPrimeira = (filtro, rotuloEmpresa, rotuloNome) => {
      const encontrada = todasOpcoes.find(filtro);
      if (!encontrada) return null;
      return {
        ...encontrada,
        empresa: rotuloEmpresa,
        nome: rotuloNome
      };
    };

    const opcoes = [
      escolherPrimeira(ehLoggiExpress, "Loggi", "Express"),
      escolherPrimeira(ehJetStandard, "J&T", "Standard"),
      escolherPrimeira(ehCorreiosSedex, "Correios", "SEDEX")
    ].filter(Boolean);

    if (!opcoes.length) {
      return res.json({
        sucesso: true,
        modoTeste: false,
        opcoes: [],
        aviso: "Nenhuma das opções configuradas está disponível para este CEP: Loggi Express, J&T Standard ou Correios SEDEX."
      });
    }

    res.json({ sucesso: true, modoTeste: false, opcoes });
  } catch (error) {
    console.error(error);
    res.status(500).json({ sucesso: false, erro: "Erro ao calcular frete." });
  }
});

app.post("/api/pedido", upload.single("foto"), (req, res) => {
  try {
    const { tema, nome, frase, telefone, cep, rua, numero, bairro, cidade, uf, complemento, freteNome, fretePreco, fretePrazo } = req.body;

    const pedidos = lerPedidos();

    const pedido = {
      id: Date.now(),
      data: new Date().toLocaleString("pt-BR"),
      tema: tema || "",
      nome: nome || "",
      frase: frase || "",
      telefone: telefone || "",
      cep: cep || "",
      endereco: {
        rua: rua || "",
        numero: numero || "",
        bairro: bairro || "",
        cidade: cidade || "",
        uf: uf || "",
        complemento: complemento || ""
      },
      frete: {
        nome: freteNome || "",
        preco: fretePreco || "",
        prazo: fretePrazo || ""
      },
      foto: req.file ? `/uploads/${req.file.filename}` : "",
      status: "Novo"
    };

    pedidos.unshift(pedido);
    salvarPedidos(pedidos);

    try {
      const analytics = lerAnalytics();
      analytics.eventos.push({ nome: "pedido_enviado", pagina: "/api/pedido", data: new Date().toISOString(), ip: req.headers["x-forwarded-for"] || req.socket.remoteAddress || "" });
      salvarAnalytics(analytics);
    } catch (e) {}

    res.json({ sucesso: true, pedido, whatsapp: WHATSAPP_NUMBER });
  } catch (error) {
    console.error(error);
    res.status(500).json({ sucesso: false, erro: "Erro ao salvar pedido." });
  }
});

app.get("/api/pedidos", (req, res) => {
  const senha = req.query.senha || "";
  if (senha !== ADMIN_PASSWORD) return res.status(401).json({ erro: "Senha inválida." });
  res.json(lerPedidos());
});

app.post("/api/pedidos/:id/status", (req, res) => {
  const senha = req.query.senha || "";
  if (senha !== ADMIN_PASSWORD) return res.status(401).json({ erro: "Senha inválida." });

  const pedidos = lerPedidos();
  const pedido = pedidos.find(p => String(p.id) === String(req.params.id));
  if (!pedido) return res.status(404).json({ erro: "Pedido não encontrado." });

  pedido.status = req.body.status || pedido.status;
  salvarPedidos(pedidos);
  res.json({ sucesso: true, pedido });
});

app.listen(PORT, () => {
  console.log(`Site rodando em http://localhost:${PORT}`);
  console.log(`Painel: http://localhost:${PORT}/painel.html`);
});
