import { createHash, timingSafeEqual } from 'node:crypto';
import express from 'express';
import pg from 'pg';

const { API_TOKEN, DB_PASSWORD, DB_HOST = '127.0.0.1' } = process.env;
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '127.0.0.1';

if (!/^[a-f0-9]{64}$/.test(API_TOKEN ?? '') || !DB_PASSWORD) {
  throw new Error('Configure API_TOKEN e DB_PASSWORD com npm run configurar.');
}

const banco = new pg.Pool({
  host: DB_HOST,
  port: Number(process.env.DB_PORT ?? 5432),
  database: 'catalogo',
  user: 'catalogo',
  password: DB_PASSWORD,
  connectionTimeoutMillis: 3000,
  statement_timeout: 5000,
});

banco.on('error', (erro) => {
  console.error('Falha em uma conexão ociosa do PostgreSQL:', erro.code ?? erro.name);
});

await banco.query(`
  CREATE TABLE IF NOT EXISTS produtos (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nome VARCHAR(120) NOT NULL CHECK (char_length(nome) > 0),
    descricao VARCHAR(500),
    preco_centavos INTEGER NOT NULL CHECK (preco_centavos >= 0),
    estoque INTEGER NOT NULL CHECK (estoque >= 0)
  )
`);

const app = express();
app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

app.get('/health', async (_req, res) => {
  try {
    await banco.query('SELECT 1');
    res.json({ status: 'ok' });
  } catch {
    res.status(503).json({ status: 'indisponivel' });
  }
});

const hash = (valor) => createHash('sha256').update(valor).digest();
const hashToken = hash(API_TOKEN);
const produtos = express.Router();

produtos.use((req, res, next) => {
  const token = /^Bearer ([a-f0-9]{64})$/i.exec(req.get('Authorization') ?? '')?.[1];
  if (!token || !timingSafeEqual(hash(token), hashToken)) {
    res.set('WWW-Authenticate', 'Bearer');
    return res.status(401).json({ erro: 'Token ausente ou inválido.' });
  }
  next();
});

const MAX_INT = 2_147_483_647;
const inteiroValido = (valor) => Number.isInteger(valor) && valor >= 0 && valor <= MAX_INT;
const colunas = 'id, nome, descricao, preco_centavos AS "precoCentavos", estoque';

produtos.param('id', (req, res, next, valor) => {
  const id = Number(valor);
  if (!/^[1-9]\d*$/.test(valor) || !inteiroValido(id)) {
    return res.status(400).json({ erro: 'O ID deve ser um inteiro positivo válido.' });
  }
  req.produtoId = id;
  next();
});

function textoValido(valor, tamanho) {
  return typeof valor === 'string' && valor.isWellFormed()
    && !valor.includes('\0') && [...valor].length <= tamanho;
}

const lerJson = express.json({ limit: '16kb' });

function exigirJson(req, res, next) {
  if (!req.is('application/json')) {
    return res.status(415).json({ erro: 'Envie Content-Type: application/json.' });
  }
  next();
}

function validarProduto(req, res, next) {
  const { nome, descricao = null, precoCentavos, estoque } = req.body ?? {};
  const nomeLimpo = typeof nome === 'string' ? nome.trim() : nome;
  const descricaoLimpa = typeof descricao === 'string' ? descricao.trim() || null : descricao;
  const campos = {};

  if (!textoValido(nomeLimpo, 120) || nomeLimpo.length === 0) {
    campos.nome = 'Informe um texto de 1 a 120 caracteres.';
  }
  if (descricaoLimpa !== null && !textoValido(descricaoLimpa, 500)) {
    campos.descricao = 'Informe null ou um texto de até 500 caracteres.';
  }
  if (!inteiroValido(precoCentavos)) {
    campos.precoCentavos = 'Informe um inteiro entre 0 e 2147483647.';
  }
  if (!inteiroValido(estoque)) {
    campos.estoque = 'Informe um inteiro entre 0 e 2147483647.';
  }
  if (Object.keys(campos).length > 0) {
    return res.status(400).json({ erro: 'Dados inválidos.', campos });
  }

  req.dadosProduto = [nomeLimpo, descricaoLimpa, precoCentavos, estoque];
  next();
}

function produtoNaoEncontrado(res) {
  return res.status(404).json({ erro: 'Produto não encontrado.' });
}

produtos.get('/', async (_req, res) => {
  const { rows } = await banco.query(`SELECT ${colunas} FROM produtos ORDER BY id`);
  res.json(rows);
});

produtos.post('/', exigirJson, lerJson, validarProduto, async (req, res) => {
  const { rows: [produto] } = await banco.query(
    `INSERT INTO produtos (nome, descricao, preco_centavos, estoque)
     VALUES ($1, $2, $3, $4) RETURNING ${colunas}`,
    req.dadosProduto,
  );
  res.location(`/produtos/${produto.id}`).status(201).json(produto);
});

produtos.get('/:id', async (req, res) => {
  const { rows: [produto] } = await banco.query(
    `SELECT ${colunas} FROM produtos WHERE id = $1`, [req.produtoId],
  );
  if (!produto) return produtoNaoEncontrado(res);
  res.json(produto);
});

produtos.put('/:id', exigirJson, lerJson, validarProduto, async (req, res) => {
  const { rows: [produto] } = await banco.query(
    `UPDATE produtos SET nome = $1, descricao = $2, preco_centavos = $3, estoque = $4
     WHERE id = $5 RETURNING ${colunas}`,
    [...req.dadosProduto, req.produtoId],
  );
  if (!produto) return produtoNaoEncontrado(res);
  res.json(produto);
});

produtos.delete('/:id', async (req, res) => {
  const { rowCount } = await banco.query('DELETE FROM produtos WHERE id = $1', [req.produtoId]);
  if (rowCount === 0) return produtoNaoEncontrado(res);
  res.status(204).end();
});

app.use('/produtos', produtos);
app.use((_req, res) => res.status(404).json({ erro: 'Rota não encontrada.' }));

app.use((erro, _req, res, _next) => {
  if (erro instanceof URIError && erro.status === 400) {
    return res.status(400).json({ erro: 'Endereço da requisição inválido.' });
  }

  const errosJson = {
    'entity.parse.failed': [400, 'JSON inválido.'],
    'entity.too.large': [413, 'O corpo da requisição excede 16 KiB.'],
    'charset.unsupported': [415, 'Codificação do JSON incompatível.'],
    'encoding.unsupported': [415, 'Codificação do corpo incompatível.'],
    'request.aborted': [400, 'Requisição interrompida.'],
    'request.size.invalid': [400, 'Tamanho do corpo inválido.'],
  };
  const [status, mensagem] = errosJson[erro.type] ?? [500, 'Erro interno.'];
  if (status === 500) console.error('Erro na API:', erro.code ?? erro.name);
  res.status(status).json({ erro: mensagem });
});

const servidor = app.listen(port, host, () => {
  console.log(`API de produtos ouvindo em http://${host}:${port}`);
});

for (const sinal of ['SIGINT', 'SIGTERM']) {
  process.once(sinal, () => {
    servidor.close(() => banco.end());
  });
}
