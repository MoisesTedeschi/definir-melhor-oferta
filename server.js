/**
 * server.js
 *
 * Implementa o contrato REST que o Journey Builder exige de toda
 * Custom Activity:
 *
 *   POST /save      -> chamado quando o usuário salva a config na tela
 *   POST /validate  -> chamado antes de permitir salvar/publicar
 *   POST /publish   -> chamado quando a Journey é ativada
 *   POST /stop      -> chamado quando a Journey é pausada/parada
 *   POST /execute   -> chamado 1x por contato, em runtime, dentro da Journey
 *
 * /execute é o único que carrega o JWT assinado pelo MC (useJwt: true
 * no config.json) e é onde a lógica de negócio da activity realmente
 * acontece.
 */

require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');

const { verificarJwt } = require('./jwtMiddleware');
const { lookupRow, lookupRows, insertRow } = require('./sfmcClient');
const { consultarMelhoresOfertas } = require('./motorDecisao');

const app = express();
app.use(bodyParser.json());
app.use('/img', express.static(path.join(__dirname, 'public/img')));
app.use('/js', express.static(path.join(__dirname, 'public/js')));

// O Journey Builder busca essa URL para descobrir a definição da activity
// (metadata, inArguments/outArguments, URLs de save/validate/publish/stop/execute).
// Sem essa rota, o erro é exatamente "Failed to load custom activity configuration file".
app.get('/config.json', (req, res) => {
  res.sendFile(path.join(__dirname, 'config.json'));
});

// Tela de configuração da activity, renderizada dentro do iframe do Journey Builder
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

// Render (e qualquer health check) usa isso para saber se o serviço está de pé
app.get('/healthz', (req, res) => res.status(200).json({ status: 'ok' }));

// --- Ciclo de vida da activity (sem lógica de negócio pesada aqui) ---

app.post('/save', (req, res) => {
  console.log('save', JSON.stringify(req.body));
  res.status(200).json({});
});

app.post('/validate', (req, res) => {
  // Aqui você pode recusar publicar a Journey se a config estiver incompleta.
  // Ex: exigir que uma DE de log tenha sido informada na UI.
  console.log('validate', JSON.stringify(req.body));
  res.status(200).json({});
});

app.post('/publish', (req, res) => {
  console.log('publish', JSON.stringify(req.body));
  res.status(200).json({});
});

app.post('/stop', (req, res) => {
  console.log('stop', JSON.stringify(req.body));
  res.status(200).json({});
});

// --- Execução em runtime, 1 chamada por contato ---

app.post('/execute', verificarJwt, async (req, res) => {
  try {
    const inArguments = req.jbPayload.inArguments || [];
    // inArguments chega como array de objetos — normaliza em 1 objeto único
    const args = Object.assign({}, ...inArguments);

    const {
      subscriberKey,
      emailAddress,
      segmentoCliente,
      canalPreferido,
      cpfOuCustomerId
    } = args;

    if (!subscriberKey) {
      return res.status(400).json({ error: 'subscriberKey ausente no inArguments.' });
    }

    // 1) Consulta o motor de decisão externo
    const ofertas = await consultarMelhoresOfertas({
      subscriberKey,
      segmentoCliente,
      cpfOuCustomerId
    });

    if (!ofertas.length) {
      // Fail-open: devolve outArguments indicando "sem oferta", para a
      // Journey tratar isso em um Decision Split de erro em vez de travar.
      return res.status(200).json({
        ofertaEncontrada: 'false',
        ofertaId: '',
        produtoNome: '',
        canalEnvio: '',
        textoMensagem: '',
        ctaTexto: '',
        ctaUrl: ''
      });
    }

    const ofertaVencedora = ofertas[0]; // já ordenado por prioridade

    // 2) Lookup da oferta e do produto associado
    const oferta = await lookupRow('DE_OFERTA', 'OfertaID', ofertaVencedora.ofertaId);

    if (!oferta || oferta.Ativo === false || oferta.Ativo === 'FALSE') {
      return res.status(200).json({
        ofertaEncontrada: 'false',
        ofertaId: ofertaVencedora.ofertaId,
        produtoNome: '',
        canalEnvio: '',
        textoMensagem: '',
        ctaTexto: '',
        ctaUrl: ''
      });
    }

    // Revalida vigência aqui — cobre o gotcha de oferta que venceu entre
    // a consulta e o envio real, se houver Wait steps na Journey.
    const hoje = new Date();
    const fimVigencia = new Date(oferta.DataFimVigencia);
    if (fimVigencia < hoje) {
      return res.status(200).json({
        ofertaEncontrada: 'false',
        ofertaId: oferta.OfertaID,
        produtoNome: '',
        canalEnvio: '',
        textoMensagem: '',
        ctaTexto: '',
        ctaUrl: ''
      });
    }

    const produto = await lookupRow('DE_PRODUTO', 'ProdutoID', oferta.ProdutoID);

    // 3) Lookup das mensagens da oferta, filtradas pelo canal preferido
    const mensagensDaOferta = await lookupRows('DE_MENSAGENS_OFERTA', 'OfertaID', oferta.OfertaID);
    let mensagem = mensagensDaOferta.find(
      m => String(m.Canal).toLowerCase() === String(canalPreferido).toLowerCase() &&
           (m.Ativo === true || m.Ativo === 'TRUE')
    );

    // Fallback de canal: se não existir mensagem no canal preferido,
    // usa a primeira mensagem ativa disponível para a oferta.
    let canalEfetivo = canalPreferido;
    if (!mensagem) {
      mensagem = mensagensDaOferta.find(m => m.Ativo === true || m.Ativo === 'TRUE');
      canalEfetivo = mensagem ? mensagem.Canal : '';
    }

    if (!mensagem) {
      return res.status(200).json({
        ofertaEncontrada: 'false',
        ofertaId: oferta.OfertaID,
        produtoNome: produto ? produto.NomeProduto : '',
        canalEnvio: '',
        textoMensagem: '',
        ctaTexto: '',
        ctaUrl: ''
      });
    }

    // Substitui placeholders simples no texto (equivalente a v() no AMPscript)
    const textoResolvido = mensagem.TextoMensagem
      .replace('{{NomeProduto}}', produto ? produto.NomeProduto : '')
      .replace('{{Nome}}', args.nome || '');

    // 4) Loga o envio para alimentar a supressão de 30 dias da Automation
    await insertRow('DE_LOG_OFERTA_ENVIADA', {
      SubscriberKey: subscriberKey,
      OfertaID: oferta.OfertaID,
      Canal: canalEfetivo,
      DataEnvio: new Date().toISOString()
    });

    // 5) Devolve os outArguments — consumidos pelo Decision Split de Canal
    //    e pelo Custom Send Activity subsequentes na Journey
    return res.status(200).json({
      ofertaEncontrada: 'true',
      ofertaId: oferta.OfertaID,
      produtoNome: produto ? produto.NomeProduto : '',
      canalEnvio: canalEfetivo,
      textoMensagem: textoResolvido,
      ctaTexto: mensagem.CTA_Texto,
      ctaUrl: mensagem.CTA_URL
    });
  } catch (err) {
    console.error('Erro em /execute:', err.message);
    // Nunca deixe a exceção travar o contato na Journey silenciosamente —
    // responda 500 para o MC registrar erro na Activity, visível em
    // Tracking > Activity Status, e monitore essa taxa de erro.
    return res.status(500).json({ error: 'Erro ao definir a melhor oferta.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Definir Melhor Oferta rodando na porta ${PORT}`));
