/**
 * motorDecisao.js
 *
 * Chamada à API externa de decisioning. Contrato conforme desenhado
 * no capítulo da Custom Activity:
 *
 *   Request  -> { subscriberKey, segmentoCliente, cpfOuCustomerId }
 *   Response -> { subscriberKey, ofertas: [{ ofertaId, prioridade }, ...] }
 *
 * Troque a implementação abaixo pela chamada real ao seu motor de
 * decisão (pode ser um serviço próprio, um modelo de propensão, ou até
 * uma regra simples de negócio hospedada fora do MC).
 */

const axios = require('axios');

async function consultarMelhoresOfertas({ subscriberKey, segmentoCliente, cpfOuCustomerId }) {
  const { data } = await axios.post(
    process.env.MOTOR_DECISAO_URL,
    { subscriberKey, segmentoCliente, cpfOuCustomerId },
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.MOTOR_DECISAO_API_KEY}`
      },
      timeout: 5000 // fail-fast: não deixe a Journey travar esperando a API externa
    }
  );

  // Ordena por prioridade (menor número = mais prioritário), robustez
  // extra caso a API não devolva já ordenado.
  const ofertas = (data.ofertas || []).sort((a, b) => a.prioridade - b.prioridade);

  return ofertas;
}

module.exports = { consultarMelhoresOfertas };
