import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const arquivo = new URL('../.env', import.meta.url);
const segredo = () => randomBytes(32).toString('hex');
const conteudo = [
  `API_TOKEN=${segredo()}`,
  `DB_PASSWORD=${segredo()}`,
  `POSTGRES_ADMIN_PASSWORD=${segredo()}`,
  'API_DOMAIN=',
  '',
].join('\n');

try {
  writeFileSync(arquivo, conteudo, { flag: 'wx', mode: 0o600 });
  console.log('.env criado. Abra o arquivo localmente para configurar o Bruno.');
} catch (erro) {
  if (erro.code !== 'EEXIST') throw erro;
  console.log('.env já existe e foi preservado.');
}
