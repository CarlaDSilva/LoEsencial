/**
 * LO ESENCIAL â Worker de noticias (Cloudflare)
 * ------------------------------------------------------------------
 * Trae varios RSS, los limpia, deduplica, clasifica el tono por palabras
 * clave y los devuelve como JSON para la PWA. Sin IA, sin coste de API.
 *
 * DESPLIEGUE (desde el navegador, sin terminal):
 *   1. Cloudflare â Workers & Pages â Create â Worker.
 *   2. Pega este archivo entero en el editor y pulsa Deploy.
 *   3. Copia la URL (algo como https://lo-esencial.TUNOMBRE.workers.dev)
 *      y pÃ©gala en Lo Esencial â Ajustes â Fuente de noticias.
 *
 * AÃADIR / VERIFICAR FEEDS: edita el array FEEDS de abajo. Cada feed lleva
 * su "tema" (debe coincidir con los temas de la app) y el nombre de la fuente.
 * Los feeds que fallen se ignoran solos, asÃ­ que puedes probar URLs sin miedo.
 */

const WORKER_VER = "10-fuentes2";   // sÃºbelo en cada cambio; mÃ­ralo abriendo  TUWORKER/?version

const FEEDS = [
  { id:"bbc",            url: "https://feeds.bbci.co.uk/mundo/rss.xml",                                  tema: "internacional",  fuente: "BBC Mundo",        grupo: "Internacional" },
  { id:"elpais",         url: "https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/portada",        tema: "espaÃ±a",         fuente: "El PaÃ­s",          grupo: "EspaÃ±a" },
  { id:"eldiario",       url: "https://www.eldiario.es/rss/",                                            tema: "espaÃ±a",         fuente: "elDiario.es",      grupo: "EspaÃ±a" },
  { id:"20min",          url: "https://www.20minutos.es/rss/",                                           tema: "espaÃ±a",         fuente: "20minutos",        grupo: "EspaÃ±a" },
  { id:"confidencial",   url: "https://www.elconfidencial.com/rss/",                                     tema: "espaÃ±a",         fuente: "El Confidencial",  grupo: "EspaÃ±a" },
  { id:"xataka",         url: "https://feeds.weblogssl.com/xataka2",                                     tema: "tecnologia",     fuente: "Xataka",           grupo: "TecnologÃ­a" },
  { id:"genbeta",        url: "https://www.genbeta.com/index.xml",                                       tema: "informatica",    fuente: "Genbeta",          grupo: "TecnologÃ­a" },
  { id:"marca",          url: "https://e00-marca.uecdn.es/rss/portada.xml",                              tema: "deportes",       fuente: "Marca",             grupo: "Deportes" },
  { id:"elpais-ciencia", url: "https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/section/ciencia/portada",  tema: "ciencia",  fuente: "El PaÃ­s Ciencia",  grupo: "Ciencia y cultura" },
  { id:"elpais-cultura", url: "https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/section/cultura/portada",  tema: "cultura",  fuente: "El PaÃ­s Cultura",  grupo: "Ciencia y cultura" },
  { id:"muy",            url: "https://www.muyinteresante.com/feed/",                                    tema: "ciencia",        fuente: "Muy Interesante",  grupo: "Ciencia y cultura", site:"muyinteresante.com", region:"ES" },
  { id:"elpais-economia",url: "https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/section/economia/portada", tema: "economia", fuente: "El PaÃ­s EconomÃ­a", grupo: "EconomÃ­a" },
  { id:"vigo-concello",  url: "https://hoxe.vigo.org/actualidade/rss.php?lang=cas",                      tema: "vigo",           fuente: "Concello de Vigo",  grupo: "Galicia y Vigo" },

  // --- Argentina: fuentes que pide Carla. Llevan "site" para el respaldo obligatorio por bÃºsqueda. ---
  { id:"clarin",         url: "https://www.clarin.com/rss/lo-ultimo/",                                   tema: "argentina",      fuente: "ClarÃ­n",            grupo: "Argentina", site:"clarin.com",     region:"AR" },
  { id:"lanacion",       url: "https://www.lanacion.com.ar/arc/outboundfeeds/rss/?outputType=xml",       tema: "argentina",      fuente: "La NaciÃ³n",         grupo: "Argentina", site:"lanacion.com.ar",region:"AR" },
  { id:"infobae",        url: "https://www.infobae.com/arc/outboundfeeds/rss/?outputType=xml",           tema: "argentina",      fuente: "Infobae",           grupo: "Argentina", site:"infobae.com",    region:"AR" },
  { id:"correogallego",    url:"https://www.elcorreogallego.es/rss",          tema:"galicia",  fuente:"El Correo Gallego",      grupo:"Galicia" },
  { id:"diariopontevedra", url:"https://www.diariodepontevedra.es/rss",       tema:"galicia",  fuente:"Diario de Pontevedra",   grupo:"Galicia" },
  { id:"eldiarioar",     url: "https://www.eldiarioar.com/rss/",                                         tema: "argentina",      fuente: "elDiarioAR",        grupo: "Argentina", site:"eldiarioar.com", region:"AR" },
];

// Fuentes que Carla exige que SIEMPRE aporten algo: si su RSS no da resultados, se buscan por Google News (site:)
const PRIORITARIAS = FEEDS.filter(f => f.site);

/* ====== Intereses por bÃºsqueda (Google News RSS): cubren Argentina, Galicia local, temas y
   cualquier tÃ©rmino libre que escriba la persona. No dependen de que el medio tenga RSS propio. ====== */
function regionGNews(region){
  return region === "AR" ? { hl:"es-419", gl:"AR", ceid:"AR:es" } : { hl:"es-ES", gl:"ES", ceid:"ES:es" };
}
function gnewsUrl(p){
  const r = regionGNews(p.region);
  if (p.kind === "geo") return "https://news.google.com/rss/headlines/section/geo/" + encodeURIComponent(p.geo) + "?hl="+r.hl+"&gl="+r.gl+"&ceid="+r.ceid;
  let q = p.q || "";
  if (p.when) q += " when:" + p.when;
  return "https://news.google.com/rss/search?q=" + encodeURIComponent(q) + "&hl="+r.hl+"&gl="+r.gl+"&ceid="+r.ceid;
}
const INTERESES_PRESET = {
  argentina:        { label:"Argentina",      tema:"argentina",    kind:"geo",    geo:"Argentina", region:"AR" },
  mujeres:          { label:"Mujeres",        tema:"mujeres",      kind:"search", q:"(mujer OR mujeres) (logra OR consigue OR rompe OR primera OR pionera OR rÃ©cord OR premio OR histÃ³rico)", region:"ES", when:"4d" },
  medioambiente:    { label:"Medio ambiente", tema:"medioambiente",kind:"search", q:"medio ambiente (EspaÃ±a OR Galicia OR clima OR sostenibilidad)", region:"ES", when:"3d" },
  galicia:          { label:"Galicia",        tema:"galicia",      kind:"search", q:"Galicia (site:farodevigo.es OR site:lavozdegalicia.es OR site:diariodepontevedra.es)", region:"ES", when:"2d" },
  vigo:             { label:"Vigo",           tema:"vigo",         kind:"search", q:"Vigo (site:farodevigo.es OR site:lavozdegalicia.es OR site:atlantico.net)", region:"ES", when:"2d" },
  morrazo:          { label:"O Morrazo",      tema:"morrazo",      kind:"search", q:"(Morrazo OR Cangas OR MoaÃ±a OR Bueu) (site:farodevigo.es OR site:lavozdegalicia.es OR site:diariodepontevedra.es)", region:"ES", when:"4d" },
  bueu:             { label:"Bueu",           tema:"bueu",         kind:"search", q:"Bueu (site:farodevigo.es OR site:lavozdegalicia.es OR site:diariodepontevedra.es)", region:"ES", when:"6d" },
};

const MODELS = [                       // prueba en orden; si uno falla/jubilan, pasa al siguiente
  "@cf/meta/llama-3.2-3b-instruct",
  "@cf/meta/llama-3.1-8b-instruct-fast",
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
];
const MAX_ITEMS = 50;           // tope de noticias devueltas
const VENTANA_HORAS = 72;       // antigÃ¼edad mÃ¡xima
const CACHE_SEG = 900;          // cachea el resultado 15 min en el edge

const PALABRAS_NEG = ["muert","herid","ataque","guerra","conflicto","crisis","violencia","incendio","accidente","vÃ­ctima","desplaz","tensiÃ³n","amenaza","recesiÃ³n","despido","temporal","alerta","condena"];
const PALABRAS_POS = ["acuerdo","rÃ©cord","avance","mejora","premio","rescate","descubr","Ã©xito","crece","recuperaciÃ³n","inaugura","histÃ³rico","logro","soluciÃ³n","ayuda"];

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
  };
}

function decode(s) {
  return (s || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ").replace(/&hellip;/g, "â¦").replace(/&mdash;/g, "â")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/\s+/g, " ").trim();
}

function tag(block, name) {
  const m = block.match(new RegExp("<" + name + "[^>]*>([\\s\\S]*?)<\\/" + name + ">", "i"));
  return m ? m[1] : "";
}

function link(block) {
  // RSS: <link>url</link>  Â·  Atom: <link href="url"/>
  const rss = tag(block, "link");
  if (rss && /^https?:/.test(decode(rss))) return decode(rss);
  const atom = block.match(/<link[^>]*href="([^"]+)"[^>]*\/?>/i);
  return atom ? atom[1] : "";
}

function tono(texto) {
  const t = texto.toLowerCase();
  if (PALABRAS_NEG.some(w => t.includes(w))) return "negativa";
  if (PALABRAS_POS.some(w => t.includes(w))) return "positiva";
  return "neutra";
}

const MORRAZO_RE = /\b(morrazo|cangas|mo[aÃ£]a)\b/i;
const BUEU_RE    = /\bbueu\b/i;
const MUJERES_RE = /(mujer|g[eÃ©]nero|feminism|igualdad|machism|violencia.{0,15}(g[eÃ©]nero|sexual)|brecha.{0,10}salar)/i;
const MEDIOAMB_RE = /(medioambiente|medio ambiente|climat|ecolog|sostenib|biodiversid|incendio.{0,10}(bosque|forestal)|contaminaci|vertido)/i;
function reclasificarTema(titulo, texto, temaDef) {
  const s = titulo + ' ' + texto;
  if (BUEU_RE.test(s)) return 'bueu';
  if (MORRAZO_RE.test(s)) return 'morrazo';
  if (MUJERES_RE.test(s)) return 'mujeres';
  if (MEDIOAMB_RE.test(s)) return 'medioambiente';
  return temaDef;
}

function parseFeed(xml, feed) {
  const out = [];
  const bloques = xml.match(/<(item|entry)[\s\S]*?<\/(item|entry)>/gi) || [];
  for (const b of bloques) {
    let titulo = decode(tag(b, "title"));
    if (!titulo) continue;
    let fuenteItem = feed.fuente;
    if (feed.dynamic) {
      // Google News: cada item trae su medio real en <source>; si no, se intenta sacar del "TÃ­tulo - Medio"
      const src = decode(tag(b, "source"));
      if (src) fuenteItem = src;
      else { const m = titulo.match(/^(.*)\s[-â]\s([^-â]{2,40})$/); if (m) { titulo = m[1].trim(); fuenteItem = m[2].trim(); } }
      if (fuenteItem && titulo.toLowerCase().endsWith(fuenteItem.toLowerCase())) {
        titulo = titulo.slice(0, titulo.length - fuenteItem.length).replace(/[\s-â]+$/, "").trim();
      }
      if (!fuenteItem) fuenteItem = "Google Noticias";
    }
    // en feeds dinÃ¡micos, la <description> suele ser una mezcla de enlaces relacionados: no sirve como resumen
    let desc = feed.dynamic ? "" : decode(tag(b, "description") || tag(b, "summary") || tag(b, "content"));
    if (desc.length > 220) desc = desc.slice(0, 217).replace(/\s+\S*$/, "") + "â¦";
    const fechaRaw = decode(tag(b, "pubDate") || tag(b, "updated") || tag(b, "published"));
    const ts = fechaRaw ? Date.parse(fechaRaw) : Date.now();
    const texto = desc && desc.toLowerCase() !== titulo.toLowerCase() ? `${titulo}. ${desc}` : titulo + ".";
    out.push({
      tema: reclasificarTema(titulo, desc, feed.tema), fuente: fuenteItem, titulo,
      texto, url: link(b),
      ts: isNaN(ts) ? Date.now() : ts,
      tono: tono(titulo + " " + desc),
      peso: texto.length > 180 ? "heavy" : "light",
    });
  }
  return out;
}

async function traer(feed) {
  try {
    const r = await fetch(feed.url, {
      headers: { "User-Agent": "LoEsencial/1.0 (+https://workers.dev)", "Accept": "application/rss+xml, application/xml, text/xml, */*" },
      cf: { cacheTtl: CACHE_SEG, cacheEverything: true },
    });
    if (!r.ok) return [];
    const items = parseFeed(await r.text(), feed);
    items.forEach(it => { it._fid = feed.id; });
    return items;
  } catch (e) {
    return [];
  }
}

async function construir(sel) {
  sel = sel || {};
  const fuentesSel = sel.fuentes;          // array de ids, o null = todas
  const interesesSel = sel.intereses || []; // array de ids de INTERESES_PRESET
  const terminos = sel.terminos || [];      // array de texto libre

  const feedsDirectos = FEEDS.filter(f => !fuentesSel || !fuentesSel.length || fuentesSel.includes(f.id));
  const feedsInteres = interesesSel.map(id => INTERESES_PRESET[id]).filter(Boolean).map(p => ({
    url: gnewsUrl(p), tema: p.tema, fuente: null, dynamic: true,
  }));
  const feedsTermino = terminos.filter(Boolean).slice(0, 8).map(t => ({
    url: gnewsUrl({ kind:"search", q:'"'+t.replace(/"/g,"")+'"', region:"ES", when:"10d" }),
    tema: t, fuente: null, dynamic: true,
  }));

  const todos = feedsDirectos.concat(feedsInteres, feedsTermino);
  const listas = await Promise.allSettled(todos.map(traer));
  let items = [];
  for (const l of listas) if (l.status === "fulfilled") items = items.concat(l.value);

  // RESPALDO OBLIGATORIO: si una fuente prioritaria seleccionada (ClarÃ­n, La NaciÃ³n, Infobae,
  // elDiarioAR, Muy Interesante) no aportÃ³ nada por su RSS, se buscan sus noticias por Google News.
  const prioSel = PRIORITARIAS.filter(f => feedsDirectos.includes(f));
  const faltan = prioSel.filter(f => !items.some(it => it._fid === f.id));
  if (faltan.length) {
    const rescate = await Promise.allSettled(faltan.map(f => traer({
      url: gnewsUrl({ kind:"search", q:"site:" + f.site, region: f.region || "ES", when:"7d" }),
      tema: f.tema, fuente: f.fuente, dynamic: true, id: f.id,
    })));
    for (const l of rescate) if (l.status === "fulfilled") {
      l.value.forEach(it => { it.fuente = it.fuente || "Google Noticias"; });
      items = items.concat(l.value);
    }
  }

  // ventana de tiempo
  const limite = Date.now() - VENTANA_HORAS * 3600 * 1000;
  let recientes = items.filter(i => i.ts >= limite);
  if (recientes.length < 8) recientes = items; // si hay pocas, relaja el filtro

  // dedupe por tÃ­tulo normalizado
  const vistos = new Set(), unicos = [];
  for (const i of recientes) {
    const k = i.titulo.toLowerCase().replace(/[^a-zÃ¡Ã©Ã­Ã³ÃºÃ±Ã¼0-9 ]/g, "").slice(0, 60);
    if (vistos.has(k)) continue;
    vistos.add(k); unicos.push(i);
  }

  // relevancia: recencia (0â80) + algo de aleatoriedad suave para variar
  const ahora = Date.now();
  unicos.forEach(i => {
    const horas = (ahora - i.ts) / 3600000;
    i.rel = Math.max(5, Math.round(80 - horas * 1.5));
  });
  unicos.sort((a, b) => b.rel - a.rel);

  return {
    generatedAt: new Date().toISOString(),
    items: unicos.slice(0, MAX_ITEMS).map(i => ({
      tema: i.tema, tono: i.tono, peso: i.peso, rel: i.rel,
      titulo: i.titulo, texto: i.texto, url: i.url,
      fuentes: [i.fuente], fecha: new Date(i.ts).toISOString(),
    })),
  };
}

/* ==== CREDENCIALES â NO se escriben aquÃ­; se aÃ±aden como Variables/Secrets del Worker ====
 * En tu Worker â Settings â Variables and Secrets â Add:
 *   Â· CF_ACCOUNT_ID  (Text)   = tu Account ID            â para los textos (resumen, explica, historia)
 *   Â· CF_AI_TOKEN    (Secret) = tu API Token de Workers AI â
 *   Â· AZURE_REGION   (Text)   = la regiÃ³n de tu recurso de voz (p. ej. westeurope)  â para la voz neural
 *   Â· AZURE_KEY      (Secret) = la clave de tu recurso de voz de Azure              â
 *   Guarda y vuelve a desplegar.
 */
const ACCOUNT_ID  = (typeof globalThis !== "undefined" && globalThis.CF_ACCOUNT_ID) || "";
const API_TOKEN   = (typeof globalThis !== "undefined" && globalThis.CF_AI_TOKEN) || "";
const AZURE_REGION = (typeof globalThis !== "undefined" && globalThis.AZURE_REGION) || "";
const AZURE_KEY    = (typeof globalThis !== "undefined" && globalThis.AZURE_KEY) || "";

async function aiText(env, system, user, maxTokens) {
let lastErr = "sin respuesta";
for (const model of MODELS) {
try {
const d = await env.AI.run(model, {
messages: [{ role: "system", content: system }, { role: "user", content: user }],
max_tokens: maxTokens || 240,
});
const out = ((d && d.response) || "").trim();
if (out) return out;
} catch (e) {
lastErr = String(e.message || e).slice(0, 140);
const m = lastErr.toLowerCase();
if (m.includes("deprecat") || m.includes("model") || m.includes("not found") || m.includes("capacity")) continue;
throw new Error(lastErr);
}
}
throw new Error(lastErr);
}
function jsonRes(obj, ttl = 0) {
    const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
    if (ttl > 0) headers['Cache-Control'] = `public, max-age=${ttl}`;
    return new Response(JSON.stringify(obj), { headers });
}

function estiloTono(tono) {
  const estilos = {
    serio:       'con tono serio y formal',
    amigable:    'con tono amigable y cercano',
    divulgativo: 'con tono divulgativo y accesible',
    tecnico:     'con tono técnico y preciso',
    calmado:     'con tono calmado y sereno',
  };
  return estilos[tono] || 'con tono neutro y claro';
}

async function explicar(url, env) {
  const texto = (url.searchParams.get("explica") || "").slice(0, 500);
  const tono = url.searchParams.get("tono") || "calmado";
  if (!texto) return jsonRes({ explica: "" });
  try {
    const out = await aiText(
      env,
      "Eres un periodista de radio que resume con rigor. Usa SOLO la informaciÃ³n del titular y descripciÃ³n recibidos. NUNCA inventes cifras, fechas ni detalles no presentes en el texto. Escribe 3 frases completas en espaÃ±ol " + estiloTono(tono) + " respondiendo: (1) QUÃ ocurre o cambia exactamente, (2) A QUIÃN afecta y cÃ³mo, (3) POR QUÃ es relevante. Si la descripciÃ³n es muy vaga, basa el resumen solo en el titular con contexto general sin inventar datos especÃ­ficos. Sin clickbait ni frases vacÃ­as.",
      "Explica en pocas palabras el contexto de esta noticia para alguien que no sigue la actualidad:\n\n" + texto, 140);
    return jsonRes({ explica: out }, 86400);
  } catch (e) { return jsonRes({ explica: "", error: String(e) }); }
}

async function historiar(url, env) {
  const texto = (url.searchParams.get("historia") || "").slice(0, 500);
  const tono = url.searchParams.get("tono") || "calmado";
  if (!texto) return jsonRes({ historia: "" });
  try {
    const out = await aiText(
      env,
      "Eres un divulgador que da el trasfondo de un tema de actualidad en espaÃ±ol, " + estiloTono(tono) + ", con rigor. Cuenta de dÃ³nde viene el asunto y por quÃ© ha llegado hasta aquÃ­, sencillo y concreto. Responde en exactamente 3 frases cortas y claras, fÃ¡ciles de entender a la primera. No repitas el titular.",
      "Da el contexto histÃ³rico y de fondo, en pocas palabras, de este tema:\n\n" + texto, 220);
    return jsonRes({ historia: out }, 86400);
  } catch (e) { return jsonRes({ historia: "", error: String(e) }); }
}

function abToB64(buf){
  const bytes = new Uint8Array(buf); let bin = ""; const chunk = 0x8000;
  for (let i=0;i<bytes.length;i+=chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i+chunk));
  return btoa(bin);
}
function escXml(s){
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");
}
const VOCES_ES = [
  "es-ES-ElviraNeural","es-ES-AlvaroNeural",     // EspaÃ±a
  "es-MX-DaliaNeural","es-MX-JorgeNeural",       // MÃ©xico
  "es-AR-ElenaNeural","es-AR-TomasNeural",       // Argentina
  "es-CO-SalomeNeural","es-US-PalomaNeural"      // Colombia / Latino EEUU
];
async function ttsRun(texto, speaker, env){
  const AZURE_KEY = env.AZURE_KEY;
const AZURE_REGION = env.AZURE_REGION;
if (!AZURE_KEY || !AZURE_REGION) throw new Error("Falta AZURE_KEY o AZURE_REGION en el Worker");
  const voz = VOCES_ES.includes(speaker) ? speaker : "es-ES-ElviraNeural";
  const lang = voz.slice(0,5);
  const ssml = "<speak version='1.0' xml:lang='" + lang + "'><voice xml:lang='" + lang + "' name='" + voz + "'>" + escXml(texto) + "</voice></speak>";
  const r = await fetch("https://" + AZURE_REGION + ".tts.speech.microsoft.com/cognitiveservices/v1", {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": AZURE_KEY,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
      "User-Agent": "LoEsencial",
    },
    body: ssml,
  });
  if (!r.ok) { const t = await r.text().catch(()=> ""); throw new Error((r.status + " " + t).slice(0, 160)); }
  return abToB64(await r.arrayBuffer());
}
async function voz(url, env) {
  let texto = (url.searchParams.get("tts") || "").replace(/\s+/g, " ").trim().slice(0, 400);
  const speaker = url.searchParams.get("voz") || "es-ES-ElviraNeural";
  if (!texto) return jsonRes({ error: "sin texto" });
  try { return jsonRes({ audio: await ttsRun(texto, speaker, env) }, 86400); }
  catch (e) { return jsonRes({ error: String(e.message || e) }); }
}

async function resumir(url, env) {
  const texto = (url.searchParams.get("resume") || "").slice(0, 600);
  const artUrl = url.searchParams.get("url") || "";
  const tono = url.searchParams.get("tono") || "calmado";
  if (!texto) return jsonRes({ texto: "" });

  // Try to fetch real article content for accurate summarization
  let fuenteIA = texto;
  if (artUrl) {
    try {
      const artR = await fetch(artUrl, {
        headers: { "User-Agent": "Mozilla/5.0", "Accept": "text/html" },
        signal: AbortSignal.timeout(5000)
      });
      if (artR.ok) {
        const raw = await artR.text();
        const clean = raw
          .replace(/<script[^>]*>[^]*?<\/script>/gi, " ")
          .replace(/<style[^>]*>[^]*?<\/style>/gi, " ")
          .replace(/<[^>]+>/g, " ")
          .replace(/&[a-z#0-9]+;/gi, " ")
          .replace(/\s+/g, " ").trim();
        if (clean.length > 300) fuenteIA = clean.slice(300, 1800);
      }
    } catch(e) { /* fallback to title+desc */ }
  }

  const instruccion = fuenteIA !== texto
    ? "Eres un periodista de radio. Tienes el texto completo del artÃ­culo. Escribe un resumen de 3 frases en espaÃ±ol " + estiloTono(tono) + " explicando exactamente: (1) quÃ© ocurre o cambia, (2) a quiÃ©n afecta y cÃ³mo, (3) por quÃ© es relevante. Usa solo datos del texto."
    : "Eres un periodista de radio. Solo tienes el titular y descripciÃ³n. NO inventes datos concretos. Escribe 2-3 frases en espaÃ±ol " + estiloTono(tono) + " con lo que sabes con certeza. Si la descripciÃ³n es vaga, di lo esencial del titular con contexto general sin fabricar detalles especÃ­ficos.";

  try {
    const out = await aiText(env, instruccion, fuenteIA);
    if (!out) return jsonRes({ texto: "" });
    let t = out.replace(/^[\s"]+|[\s"]+$/g,"").replace(/\s+/g," ").trim();
    t = t.replace(/^(Aqu[iÃ­] te (dejo|presento|ofrezco)[^:]*|A continuaci[oÃ³]n te [^:]*|Por supuesto[,!]?\s+[^:]*|Claro[,!]?\s+[^:]*|Entendido[,!]?\s+[^:]*|Resumen:)[:\s]*/i, "");
    return jsonRes({ texto: t.trim() });
  } catch(e) {
    return jsonRes({ texto: "", error: String(e) });
  }
}

export default {
async fetch(request, env, ctx) {
return handleRequest(request, env);
}
};

async function handleRequest(request, env) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors() });

  const url = new URL(request.url);
  if (url.searchParams.has("version")) return jsonRes({
    version: WORKER_VER, tts: "azure",
    azure: !!(AZURE_KEY && AZURE_REGION),
    ia: !!(ACCOUNT_ID && API_TOKEN)
  });
  if (url.searchParams.has("catalogo")) return jsonRes({
    fuentes: FEEDS.map(f => ({ id:f.id, fuente:f.fuente, grupo:f.grupo, tema:f.tema })),
    intereses: Object.keys(INTERESES_PRESET).map(id => ({ id, label: INTERESES_PRESET[id].label })),
  });
  if (url.searchParams.has("explica")) return explicar(url, env);   // IA: contexto
  if (url.searchParams.has("historia")) return historiar(url, env); // IA: trasfondo histÃ³rico
  if (url.searchParams.has("tts")) return voz(url, env);            // voz neural (Azure)
  if (url.searchParams.has("resume")) return resumir(url, env);     // IA: reescribir/resumir

  // feed de noticias, con cachÃ© de borde de 15 min â la clave incluye la selecciÃ³n de fuentes/intereses
  const fuentesParam = url.searchParams.get("fuentes");      // csv de ids de FEEDS, vacÃ­o = todas
  const interesesParam = url.searchParams.get("intereses");  // csv de ids de INTERESES_PRESET
  const terminosParam = url.searchParams.get("terminos");    // csv de texto libre (encodeURIComponent cada uno)
  const sel = {
    fuentes: fuentesParam ? fuentesParam.split(",").filter(Boolean) : null,
    intereses: interesesParam ? interesesParam.split(",").filter(Boolean) : [],
    terminos: terminosParam ? terminosParam.split(",").map(decodeURIComponent).filter(Boolean) : [],
  };

  const cache = caches.default;
  const cacheKey = new Request(request.url, request);
  let hit = await cache.match(cacheKey);
  if (hit) return hit;

  const data = await construir(sel);
  const res = new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "max-age=" + CACHE_SEG, ...cors() },
  });
  await cache.put(cacheKey, res.clone());
  return res;
}
