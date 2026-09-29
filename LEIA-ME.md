# Localizador CDF online

A interface é um site estático para **GitHub Pages**. Os arquivos bancários são enviados para um bucket **privado** do Supabase, e o índice permite procurar pelos últimos 4 a 8 dígitos do cartão. O arquivo de exemplo mascara o meio do número; nesse caso, somente os últimos 4 dígitos são pesquisáveis.

## Configuração inicial

1. No projeto Supabase `yqzenjugpyhtaurksmpr`, abra **SQL Editor** e execute `instalar_supabase.sql` uma vez. O script cria tabelas com prefixo `cdf_`, o bucket privado, a pesquisa e regras de acesso por usuário; ele não modifica as tabelas dos outros sistemas.
2. Em **Authentication → Users**, crie seu usuário com e-mail e senha. Desative cadastros públicos se não quiser que outras pessoas criem contas próprias. Cada usuário vê somente seus próprios arquivos.
3. A URL e a chave publicável desse projeto já estão em `config.js`. **Nunca** use `service_role` ou uma chave secreta em arquivos publicados no GitHub.
4. Publique no GitHub Pages apenas `index.html`, `styles.css`, `app.js`, `config.js` e `.nojekyll`. É possível colocar esses arquivos na raiz do repositório e configurar **Settings → Pages → Deploy from a branch → main → /(root)**. O arquivo SQL e este guia podem ficar no repositório, mas **nenhum CDF** deve ser adicionado ao Git.
5. Abra a URL do Pages, entre com sua conta e selecione a pasta ou os arquivos .cdf/.xml. As consultas posteriores usarão os arquivos já armazenados, inclusive em outros dispositivos com seu login.

O bucket armazena o CDF original, com todos os dados que o banco enviou; a tabela de pesquisa guarda apenas o final disponível de cada cartão. O mesmo arquivo, identificado pelo hash SHA-256, não é importado duas vezes para a mesma conta. O limite inicial é de 12 MB por arquivo; a tela mostra os 200 envios mais recentes, e a pesquisa retorna até 200 arquivos por consulta. O envio é manual: para receber os arquivos do banco automaticamente, será necessária uma integração adicional.

### Estrutura

- `index.html`, `styles.css`, `app.js`: interface e importação/pesquisa.
- `config.js`: URL e chave pública do Supabase, fornecidas por você.
- `instalar_supabase.sql`: estrutura e controle de acesso no banco.
- `.nojekyll`: evita interferência do Jekyll no GitHub Pages.

### Segurança

Não coloque CDFs em pastas do repositório GitHub, nem em um bucket público. O GitHub Pages publica os arquivos do site; os dados bancários precisam ficar no bucket privado, com as políticas do SQL acima. A chave pública no `config.js` não concede acesso aos arquivos por si só: operações exigem login e passam pelas políticas de acesso.
