/**
 * main.js
 *
 * Postmonger é a biblioteca da Salesforce para comunicação entre o
 * iframe da Custom Activity e o Journey Builder (postMessage por baixo
 * dos panos). Sem isso, o Journey Builder nunca considera a activity
 * "configurada" e o botão de salvar no canvas fica travado.
 */

var connection = new Postmonger.Session();
var payload = {};

// --- Ciclo de eventos exigido pelo Journey Builder ---

// 'ready' precisa ser disparado assim que o iframe carrega — é essa
// mensagem que avisa o Journey Builder que a tela está pronta. Ele então
// responde disparando 'initActivity' com os dados salvos da activity.
// Ficar esperando 'initActivity' para só então disparar 'ready' é um
// impasse: nenhum dos dois lados dá o primeiro passo, e o iframe fica
// carregando para sempre — foi exatamente esse o bug aqui.
connection.trigger('ready');

connection.on('initActivity', function (data) {
  if (data) {
    payload = data;
  }

  // Já chega "configurada" porque não há campos que o usuário precise
  // preencher manualmente na tela — todo o dado vem do inArguments.
  connection.trigger('updateButton', { button: 'next', text: 'done', enabled: true });
});

connection.on('clickedNext', function () {
  // inArguments definidos aqui em runtime (poderiam também vir 100% do
  // config.json — mantidos nos dois lugares por clareza).
  payload['metaData'] = payload['metaData'] || {};
  payload['metaData'].isConfigured = true;

  payload['arguments'] = payload['arguments'] || {};
  payload['arguments'].execute = payload['arguments'].execute || {};
  payload['arguments'].execute.inArguments = [
    {
      subscriberKey: '{{Contact.Key}}',
      emailAddress: '{{Contact.Attribute."DE_Entrada_Journey_Oferta"."EmailAddress"}}',
      segmentoCliente: '{{Contact.Attribute."DE_Entrada_Journey_Oferta"."SegmentoCliente"}}',
      canalPreferido: '{{Contact.Attribute."DE_Entrada_Journey_Oferta"."CanalPreferido"}}',
      cpfOuCustomerId: '{{Contact.Attribute."DE_Entrada_Journey_Oferta"."CPF_ou_CustomerID"}}'
    }
  ];

  connection.trigger('updateActivity', payload);
});
