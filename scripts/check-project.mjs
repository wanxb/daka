import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const normalized = (file) => file.replaceAll('\\', '/');
const read = (file) => readFileSync(file, 'utf8');

/** Check native reachability and dependency boundaries without loading wx, writing files or touching user data. */
export function inspectProject(projectRoot) {
  const root = resolve(projectRoot, 'miniprogram');
  const files = readdirSync(root, { recursive: true })
    .map(String)
    .filter((file) => file.endsWith('.ts'))
    .map((file) => resolve(root, file));
  const modules = new Set(files);
  const errors = [];
  const graph = new Map();
  const runtimeGraph = new Map();
  const label = (file) => normalized(relative(root, file));
  const resolveModule = (from, target) => {
    if (!target.startsWith('.')) {
      errors.push(`${label(from)}: 原生代码不能依赖外部模块 ${target}`);
      return null;
    }
    const base = resolve(dirname(from), target);
    const destination = [base + '.ts', resolve(base, 'index.ts')].find((file) => modules.has(file));
    if (!destination) errors.push(`${label(from)}: 模块不存在 ${target}`);
    return destination;
  };
  for (const file of files) {
    const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true);
    const all = new Set();
    const runtime = new Set();
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
      if (!statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const destination = resolveModule(file, statement.moduleSpecifier.text);
      if (!destination) continue;
      all.add(destination);
      const layer = label(file).split('/')[0];
      const targetLayer = label(destination).split('/')[0];
      if (layer === 'domain' && label(destination) === 'domain/model.ts')
        errors.push(`${label(file)}: 领域内部须直接依赖责任模块，不能反向引用model入口`);
      // Domain and persistence must remain usable in Node without depending on page/controllers or application commands.
      if (
        (layer === 'domain' && targetLayer !== 'domain') ||
        (layer === 'infrastructure' && !['domain', 'infrastructure'].includes(targetLayer)) ||
        (layer === 'application' && ['pages', 'components'].includes(targetLayer)) ||
        (['pages', 'components'].includes(layer) && targetLayer === 'infrastructure')
      )
        errors.push(`${label(file)}: 分层依赖倒置 → ${label(destination)}`);
      const clause = ts.isImportDeclaration(statement) ? statement.importClause : statement;
      const bindings = ts.isImportDeclaration(statement)
        ? clause?.namedBindings
        : statement.exportClause;
      const onlyTypes =
        clause?.isTypeOnly ||
        (!clause?.name &&
          bindings &&
          (ts.isNamedImports(bindings) || ts.isNamedExports(bindings)) &&
          bindings.elements.length > 0 &&
          bindings.elements.every((entry) => entry.isTypeOnly));
      if (!onlyTypes) runtime.add(destination);
    }
    graph.set(file, all);
    runtimeGraph.set(file, runtime);
  }

  // Keep cycles out of runtime initialization; type-only references remain legal and still count for reachability.
  const visited = new Set();
  const active = new Set();
  const checkCycles = (file, chain = []) => {
    if (active.has(file)) {
      errors.push('运行时循环依赖: ' + [...chain, file].map(label).join(' → '));
      return;
    }
    if (visited.has(file)) return;
    visited.add(file);
    active.add(file);
    for (const next of runtimeGraph.get(file) || []) checkCycles(next, [...chain, file]);
    active.delete(file);
  };
  files.forEach((file) => checkCycles(file));

  const app = JSON.parse(read(resolve(root, 'app.json')));
  const entries = new Set([resolve(root, 'app.ts')]);
  const styles = new Set([resolve(root, 'app.wxss')]);
  const routes = new Set();
  const includeRoute = (route) => {
    if (routes.has(route)) return;
    routes.add(route);
    entries.add(route + '.ts');
    styles.add(route + '.wxss');
    for (const extension of ['ts', 'json', 'wxml', 'wxss'])
      if (!existsSync(route + '.' + extension))
        errors.push(`路由/组件文件不存在: ${label(route)}.${extension}`);
    if (!existsSync(route + '.json')) return;
    const config = JSON.parse(read(route + '.json'));
    for (const target of Object.values(config.usingComponents || {}))
      includeRoute(
        target.startsWith('/') ? resolve(root, '.' + target) : resolve(dirname(route), target),
      );
  };
  for (const route of app.pages || []) includeRoute(resolve(root, route));
  for (const target of Object.values(app.usingComponents || {}))
    includeRoute(resolve(root, target.replace(/^\//, '')));
  const reachable = new Set();
  const visit = (file) => {
    if (reachable.has(file)) return;
    reachable.add(file);
    for (const next of graph.get(file) || []) visit(next);
  };
  entries.forEach(visit);
  for (const file of files)
    if (!reachable.has(file)) errors.push(`未被原生入口引用的模块: ${label(file)}`);

  // Follow WXSS imports from real routes, preserving the platform's stylesheet cascade rather than guessing by class names.
  const seenStyles = new Set();
  const includeStyle = (file) => {
    if (seenStyles.has(file)) return;
    seenStyles.add(file);
    if (!existsSync(file)) {
      errors.push(`样式文件不存在: ${label(file)}`);
      return;
    }
    for (const [, target] of read(file).matchAll(/@import\s+['"]([^'"]+)['"]\s*;/g))
      includeStyle(resolve(dirname(file), target));
  };
  styles.forEach(includeStyle);
  for (const relativeFile of readdirSync(root, { recursive: true }).map(String)) {
    const file = resolve(root, relativeFile);
    if (file.endsWith('.wxss') && !seenStyles.has(file))
      errors.push(`未被原生入口引用的样式: ${label(file)}`);
    if (!/\.(?:ts|wxml|wxss)$/.test(file)) continue;
    // Finite dynamic icon/color pairs are validated separately by appearance.test.ts; check literal asset paths here.
    for (const [, asset] of read(file).matchAll(
      /['"`]?(\/assets\/[\w./-]+\.(?:svg|png|jpg|jpeg|webp))['"`]?/g,
    ))
      if (!existsSync(resolve(root, '.' + asset)))
        errors.push(`${label(file)}: 静态资源不存在 ${asset}`);
  }
  return { errors, modules: files.length, routes: routes.size, styles: seenStyles.size };
}

// Importing this checker in regression tests is read-only; only direct CLI execution prints or sets an exit status.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = inspectProject(resolve(import.meta.dirname, '..'));
  if (result.errors.length) {
    result.errors.forEach((error) => console.error(error));
    process.exitCode = 1;
  } else
    console.log(
      `工程结构通过：${result.modules} 个TS模块、${result.routes} 个页面/组件、${result.styles} 个样式文件；无运行时循环、倒置或悬空引用。`,
    );
}
