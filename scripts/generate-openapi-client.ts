import fs from 'fs';
import path from 'path';

const OPENAPI = fs.existsSync(path.resolve(process.cwd(), 'openapi.json'))
  ? path.resolve(process.cwd(), 'openapi.json')
  : path.resolve(process.cwd(), 'public/openapi.json');
const OUT = path.resolve(process.cwd(), 'lib/generatedApiClient.ts');

function toFnName(method: string, route: string) {
  const parts = route.split('/').filter(Boolean).map(p => p.replace(/[^a-zA-Z0-9{}]/g, ''));
  const name = parts.map(p => p.startsWith('{') ? 'By' + p.replace(/[{}]/g, '').replace(/(^.|-.)/g, s=>s.replace(/-/,'').toUpperCase()) : p.replace(/(^.|-.)/g, s=>s.replace(/-/,'').toUpperCase())).join('');
  return method.toLowerCase() + (name ? name[0].toUpperCase()+name.slice(1) : 'Root');
}

function render() {
  const json = JSON.parse(fs.readFileSync(OPENAPI, 'utf8'));
  const lines: string[] = [];
  lines.push("/* Auto-generated API client from openapi.json — do not edit directly */");
  lines.push("import { get, post, put, patch, del } from './apiClient';");
  lines.push('');

  for (const [route, methods] of Object.entries<any>(json.paths || {})) {
    for (const [method, op] of Object.entries<any>(methods)) {
      const fn = toFnName(method, route as string);

      const hasBody = ['post','put','patch'].includes(method.toLowerCase());
      const pathParams = Array.from((route as string).matchAll(/\{([^}]+)\}/g), (m: any) => m[1]);

      // function signature
      const generics = '<T = any>';
      let sig = `export async function ${fn}${generics}(`;
      const args: string[] = [];
      if (hasBody) args.push('body?: any');
      if (pathParams.length) args.push(`pathParams?: { ${pathParams.map(p=>`${p}: string | number`).join('; ')} }`);
      args.push('opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }');
      sig += args.join(', ') + '): Promise<T> {';
      lines.push(sig);

      // build path
      let buildPath = `let path = \`${route}\`;`;
      if (pathParams.length) {
        for (const p of pathParams) {
          buildPath = buildPath + `\n  if (!pathParams || pathParams.${p} === undefined) throw new Error('Missing path param ${p}');`;
          buildPath = buildPath + `\n  path = path.replace('{${p}}', encodeURIComponent(String(pathParams.${p})));`;
        }
      }
      lines.push('  ' + buildPath.replace(/\n/g,'\n  '));

      // call underlying client
      const helper = method.toLowerCase() === 'delete' ? 'del' : method.toLowerCase();
      if (hasBody) {
        lines.push(`  return ${helper}<T>(path, body, opts);`);
      } else {
        lines.push(`  return ${helper}<T>(path, opts);`);
      }

      lines.push('}');
      lines.push('');
    }
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, lines.join('\n'));
  console.log('Wrote', OUT);
}

render();
