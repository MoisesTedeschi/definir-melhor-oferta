/**
 * jwtMiddleware.js
 *
 * O Journey Builder assina o payload de /execute (e demais callbacks,
 * se useJwt=true no config.json) usando o JWT Secret gerado quando você
 * instala a Custom Activity como Component de um Installed Package.
 *
 * Sem essa validação, qualquer requisição POST no seu endpoint seria
 * aceita como se viesse do MC — falha de segurança básica, não opcional.
 */

const jwt = require('jsonwebtoken');

function verificarJwt(req, res, next) {
  const token = req.body && req.body.jwt;

  if (!token) {
    return res.status(400).json({ error: 'JWT ausente no payload.' });
  }

  jwt.verify(token, process.env.JB_JWT_SECRET, { algorithms: ['HS256'] }, (err, decoded) => {
    if (err) {
      console.error('Falha na validação do JWT:', err.message);
      return res.status(401).json({ error: 'JWT inválido.' });
    }

    // O payload real (inArguments, contactKey, etc.) vem dentro do JWT
    // decodificado, não no body cru.
    req.jbPayload = decoded;
    next();
  });
}

module.exports = { verificarJwt };
