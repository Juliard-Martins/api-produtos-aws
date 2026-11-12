# API de Produtos

API REST para um catálogo de produtos. O Express recebe as requisições e o PostgreSQL armazena os registros. As rotas de produtos exigem um token Bearer compartilhado pelo grupo. A implantação usa Docker Compose em uma instância AWS EC2.

## Executar localmente

Tenha [Node.js 24](https://nodejs.org/) e [Docker com Compose](https://docs.docker.com/compose/install/) disponíveis. Na pasta deste projeto, execute:

```sh
npm run configurar
docker compose up -d --build --wait
curl http://127.0.0.1:3000/health
```

Use `curl.exe` no PowerShell. A resposta esperada é `{"status":"ok"}`. A rota de saúde verifica se o PostgreSQL aceita consultas. O comando de configuração cria `.env` com valores aleatórios e preserva um arquivo existente. As variáveis estão documentadas em [.env.example](.env.example).

O volume `dados_postgres` mantém os produtos entre reinícios. `docker compose down` encerra os serviços e preserva o volume. A senha do banco e a senha administrativa do `.env` são usadas na criação inicial do volume. Se precisar trocar essas senhas com o volume existente, altere as senhas das respectivas contas no PostgreSQL antes de atualizar o arquivo e recriar os serviços.

## Contrato HTTP

| Método | Caminho | Sucesso | Ação |
| --- | --- | --- | --- |
| GET | `/health` | 200 | Verificar se a API alcança o banco |
| GET | `/produtos` | 200 | Listar produtos em ordem de ID |
| GET | `/produtos/:id` | 200 | Consultar um produto |
| POST | `/produtos` | 201 | Cadastrar e informar o endereço no cabeçalho `Location` |
| PUT | `/produtos/:id` | 200 | Substituir os campos editáveis |
| DELETE | `/produtos/:id` | 204 | Excluir e retornar uma resposta sem corpo |

Use `Authorization: Bearer <API_TOKEN>` nas rotas `/produtos`. O token é lido do `.env`. Envie `Content-Type: application/json` no POST e no PUT.

```json
{
  "nome": "Caderno",
  "descricao": "Caderno pautado de 80 folhas",
  "precoCentavos": 1590,
  "estoque": 12
}
```

O preço é um inteiro em centavos. Por exemplo, `1590` representa R$ 15,90. O estoque também é um inteiro. Ambos aceitam de 0 a 2.147.483.647. O nome aceita de 1 a 120 caracteres e a descrição aceita até 500 caracteres ou `null`. Ao omitir a descrição no PUT, ela passa a ser `null`. O PostgreSQL gera o ID.

Token ausente ou inválido resulta em **401**. Dados ou ID inválidos retornam **400**. Um produto inexistente retorna **404**. Um formato de corpo incompatível retorna **415**.

## Testar no Bruno

1. No [Bruno](https://www.usebruno.com/), abra a pasta `bruno` como uma coleção.
2. Selecione o ambiente **Local**. Preencha a variável secreta `apiToken` com o valor de `API_TOKEN` do `.env` local. Para testar na nuvem, use o ambiente **AWS** com a URL e o token da instância. Se estiver usando o túnel SSH, informe a URL local do túnel no ambiente **AWS**.
3. No runner, execute a coleção em ordem, sem paralelismo. O POST salva o ID em `produtoId` para as requisições seguintes. No fim, a própria coleção apaga o registro de demonstração.
4. Confira as 10 requisições e os 20 testes. A coleção cobre o CRUD, leitura após atualização, exclusão confirmada, token ausente e preço negativo.

Para rodar pela CLI, crie um arquivo local `.env.runner.bru` na raiz do projeto com o formato abaixo e troque os valores. O Git ignora esse arquivo.

```bru
vars {
  baseUrl: http://127.0.0.1:3000
  apiToken: COLE_O_TOKEN_DESTE_AMBIENTE
}
```

```sh
cd bruno
npx --yes @usebruno/cli@4.3.0 run --env-file ../.env.runner.bru
```

## Implantar na AWS

Use uma conta AWS do grupo ou um laboratório da faculdade que permita criar instâncias EC2. Quem se qualificar como novo cliente pode escolher o plano gratuito e conferir os tipos de instância e os créditos disponíveis no console. [Planos do AWS Free Tier](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier-plans.html)

A máquina Ubuntu roda na AWS. O computador do grupo pode usar Windows, macOS ou Linux. O SSH e o SCP iniciam conexões de saída para o IPv4 público da EC2. O roteador local pode ficar com a configuração atual. A liberação de entrada é feita no grupo de segurança da instância.

### 1. Criar a instância e configurar SSH

No EC2, lance uma instância **Ubuntu Server 24.04 LTS** em uma sub-rede pública com IPv4 público. Escolha um tipo disponível para a conta e confirme o custo no console. Associe um par de chaves e guarde o arquivo `.pem` no computador de quem administrará a instância.

No grupo de segurança, permita **TCP 22** com origem **My IP** ou o CIDR dos administradores. Mantenha **3000** e **5432** sem regra de entrada. Para publicação HTTPS, permita também **TCP 80** e **TCP 443** para os clientes e para a validação do certificado.

[Iniciar uma instância EC2](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/EC2_GetStarted.html) · [Configurar grupos de segurança](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/creating-security-group.html)

### 2. Enviar o código e subir os serviços

Compacte os arquivos versionados ou use o ZIP de código entregue. Do computador local, envie o arquivo e conecte-se por SSH. Substitua o nome da chave e `IP_PUBLICO` pelos valores da instância. No Linux ou macOS, execute antes `chmod 400 chave-ec2.pem` para restringir a leitura da chave.

```sh
scp -i chave-ec2.pem api-produtos-aws.zip ubuntu@IP_PUBLICO:~/api-produtos-aws.zip
ssh -i chave-ec2.pem ubuntu@IP_PUBLICO
```

Se o SSH não conectar pelo Windows, use `Test-NetConnection IP_PUBLICO -Port 22` no PowerShell. Se `TcpTestSucceeded` estiver como `False`, confira se a EC2 está em execução, se tem IPv4 público e se a regra SSH inclui o IP público atual da sua rede. Se a rede bloquear conexões de saída na porta 22, o terminal do [EC2 Instance Connect no navegador](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-instance-connect-prerequisites.html) usa HTTPS e exige uma regra SSH para o serviço da AWS e permissão IAM.

No Ubuntu, instale o Docker Engine com o plugin Compose pelo [guia oficial do Docker](https://docs.docker.com/engine/install/ubuntu/). Depois execute:

```sh
sudo apt-get update
sudo apt-get install -y unzip
unzip -o api-produtos-aws.zip
cd api-produtos-aws
sudo docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/app" -w /app node:24-bookworm-slim node scripts/configurar-env.js
sudo docker compose up -d --build --wait
curl http://127.0.0.1:3000/health
```

Abra o `.env` da instância em uma sessão privada para configurar o token no Bruno. Guarde o token e a chave SSH fora do repositório e da gravação.

### 3. Acessar a API hospedada

**Via túnel SSH.** No computador local, mantenha esta sessão aberta enquanto usa o Bruno:

```sh
ssh -i chave-ec2.pem -N -o ExitOnForwardFailure=yes -L 127.0.0.1:3100:127.0.0.1:3000 ubuntu@IP_PUBLICO
```

Use `http://127.0.0.1:3100` no Bruno com o token da instância. O tráfego até a AWS é transportado pelo SSH.

**Via HTTPS público.** Aponte um domínio que o grupo controla para o IPv4 público da instância. Preencha `API_DOMAIN` no `.env` com o hostname, sem `https://`. Com as portas 80 e 443 abertas, suba o Caddy:

```sh
sudo docker compose -f compose.yaml -f compose.https.yaml up -d --build --wait
curl https://api.seu-dominio.example/health
```

Use a URL HTTPS real no ambiente **AWS** do Bruno e rode a coleção completa. O Caddy obtém o certificado e encaminha as requisições ao Express. [HTTPS automático no Caddy](https://caddyserver.com/docs/automatic-https)

## Apresentação

Mostre o repositório, a instância EC2 e as regras do grupo de segurança. No Bruno, rode a coleção no ambiente AWS e abra as respostas do POST, do PUT e do GET final. Mostre o ID reaproveitado na sequência, o preço em centavos e o retorno 404 após a exclusão. Grave essa execução antes da apresentação para ter uma cópia caso a rede da faculdade bloqueie o acesso.
