// Offline consumer tooling; copy unchanged alongside handbook.mjs.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, lstatSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sha = text => createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');
const read = file => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const core = ['capture-project-learnings', 'compile-feature-spec', 'manage-issues', 'maintain-project', 'review-change', 'sync-docs-issues', 'work-on-task'];
export const mapSections = ['Components', 'Documentation', 'Commands', 'Generated areas', 'Ownership'];
function local(root, reference) {
  if (typeof reference !== 'string' || !reference || reference.includes('\\') || reference.includes(':')) throw new Error('Use a repository-relative reference.');
  const [file, anchor] = reference.split('#');
  const target = path.resolve(root, file);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Reference must stay within the repository.');
  // Reject symlink parents as well as symlink files, including write destinations.
  let current = root;
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw new Error('Symlink references are not supported.');
  }
  return { target, anchor };
}
const anchorOf = heading => heading.toLowerCase().replace(/[^\p{L}\p{N}_\- ]/gu, '').trim().replace(/ /g, '-');
function document(root, reference) {
  const { target, anchor } = local(root, reference);
  let text = read(target);
  if (anchor) {
    const lines = text.split('\n');
    const start = lines.findIndex(line => /^#{1,6} /.test(line) && anchorOf(line.replace(/^#+ /, '')) === anchor);
    if (start < 0) throw new Error(`Missing section #${anchor}`);
    const depth = lines[start].match(/^#+/)[0].length;
    const tail = lines.slice(start + 1);
    const end = tail.findIndex(line => /^#{1,6} /.test(line) && line.match(/^#+/)[0].length <= depth);
    text = lines[start] + '\n' + (end < 0 ? tail : tail.slice(0, end)).join('\n');
  }
  return { text, target };
}
function configAt(root) {
  const config = JSON.parse(read(local(root, 'handbook.json').target));
  if (config.version !== 1 || !['source', 'consumer'].includes(config.kind) || !Array.isArray(config.technologySkills) || config.technologySkills.some(name => typeof name !== 'string' || !/^[a-z0-9-]+$/.test(name))) throw new Error('Invalid handbook.json: require version 1, kind source|consumer, and technologySkills array.');
  return config;
}
export function checkReadiness(root) {
  root = path.resolve(root);
  const warnings = [];
  let config;
  try { config = configAt(root); } catch (error) { return { ready: false, warnings: [`handbook.json: ${error.message}`] }; }
  for (const key of ['guidance', 'sourceMap']) {
    try {
      const { text, target } = document(root, config[key]);
      if (!text.trim()) throw new Error('Document is empty.');
      if (key === 'sourceMap') for (const heading of mapSections) {
        const lines = text.split('\n'), index = lines.findIndex(line => /^#{1,6} /.test(line) && line.replace(/^#+ /, '').trim() === heading);
        const end = lines.findIndex((line, i) => i > index && /^#{1,6} /.test(line));
        if (index < 0 || !lines.slice(index + 1, end < 0 ? undefined : end).some(line => line.trim())) warnings.push(`${config[key]}: add a nonempty ${heading} section (explicit unknowns are allowed).`);
      }
      for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
        const ref = match[1];
        if (/^[a-z]+:\/\//i.test(ref) || ref.startsWith('mailto:')) continue;
        const [file, anchor] = ref.split('#');
        const relative = path.relative(root, path.resolve(path.dirname(target), file || path.basename(target))).split(path.sep).join('/');
        const checked = local(root, relative + (anchor ? '#' + anchor : ''));
        if (!existsSync(checked.target)) throw new Error(`Broken reference: ${ref}`);
        if (anchor && checked.target.endsWith('.md')) document(root, relative + '#' + anchor);
      }
    } catch (error) { warnings.push(`${key}: ${error.message}`); }
  }
  try {
    const agents = read(local(root, 'AGENTS.md').target);
    for (const ref of [config.guidance, config.sourceMap]) if (typeof ref !== 'string' || !agents.includes(ref)) warnings.push(`AGENTS.md must route to ${ref || 'local guidance and source map'}.`);
    if (!agents.includes('handbook:check') && !agents.includes('scripts/handbook.mjs')) warnings.push('AGENTS.md must describe the Handbook baseline command.');
  } catch (error) { warnings.push(`AGENTS.md: ${error.message}`); }
  for (const name of [...core, ...config.technologySkills]) {
    try { metadata(read(local(root, `.agents/skills/${name}/SKILL.md`).target), name); }
    catch (error) { warnings.push(`Skill ${name}: ${error.message}`); }
  }
  return { ready: warnings.length === 0, warnings };
}
function metadata(text, name) {
  if (!text.startsWith('---\n')) throw new Error('Missing skill frontmatter.');
  const front = text.split('\n---\n')[0];
  const scalar = key => {
    const raw = front.match(new RegExp(`^${key}: (.+)$`, 'm'))?.[1];
    if (!raw) throw new Error(`Missing ${key}.`);
    return raw.startsWith('"') ? JSON.parse(raw) : raw.replace(/^'|'$/g, '');
  };
  if (scalar('name') !== name) throw new Error('Skill identity does not match directory.');
  return { name, description: scalar('description'), userInvocable: front.match(/^user-invocable: (true|false)$/m)?.[1] };
}
function entry(meta, body) {
  const text = `---\nname: ${meta.name}\ndescription: ${JSON.stringify(meta.description)}\n${meta.userInvocable ? `user-invocable: ${meta.userInvocable}\n` : ''}---\n\n${body}\n`;
  return text + `<!-- handbook-managed:${sha(text)} -->\n`;
}
function sharedEntry(meta) {
  return entry(meta, `Use the task's existing Handbook path and full revision. Only if no baseline is\nrecorded, run \`npm run handbook:check\` (or \`node scripts/handbook.mjs check\`).\nRead \`docs/bootstrap.md\`, \`docs/work-policy.md\` and\n\`.agents/skills/${meta.name}/SKILL.md\` with \`git -C PATH show REVISION:FILE\`.\nRead this project's guidance and source map declared in \`handbook.json\`.\nResolve all shared references at that same revision; use \`resources --revision SHA\`\nthrough the launcher for filesystem assets. Never substitute the mutable checkout.\nRetain path/revision in handoffs and resume summaries. If lost, recover from context\nfirst; otherwise establish a new baseline and report the discontinuity.\nIf unavailable, continue under local guidance and pause only dependent decisions.`);
}
function claudeEntry(meta) {
  return entry(meta, `Read and follow the canonical local entrypoint\n[${meta.name}](../../../.agents/skills/${meta.name}/SKILL.md).\nResolve its relative references from that canonical file, not this wrapper.\nFor shared guidance, retain the task's Handbook revision through continuation.\nThis reference grants no hooks, tools, permissions, or delegation authority.`);
}
export function syncEntrypoints(root, { write = false, source } = {}) {
  root = path.resolve(root);
  const warnings = [], changed = [];
  let config;
  try { config = configAt(root); } catch (error) { return { warnings: [error.message], changed }; }
  const put = (relative, wanted) => {
    const { target } = local(root, relative);
    const old = existsSync(target) ? read(target) : '';
    if (old.startsWith(wanted)) return;
    warnings.push(`Entrypoint drift: ${relative}`);
    if (!write) return;
    let suffix = '';
    if (old) {
      const match = old.match(/^([\s\S]*?)<!-- handbook-managed:([a-f0-9]{64}) -->\n([\s\S]*)$/);
      if (!match || sha(match[1]) !== match[2]) { warnings.push(`Preserved customized/unmanaged file: ${relative}; reconcile manually.`); return; }
      suffix = match[3];
    }
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, wanted + suffix);
    changed.push(relative);
  };
  // Consumer upgrades explicitly select a committed resource snapshot as source.
  if (config.kind === 'consumer' && source) {
    source = realpathSync(source);
    const contract = JSON.parse(read(path.join(source, 'handbook-contract.json')));
    if (contract.protocolVersion !== 1) throw new Error('Unsupported source contract.');
    for (const name of new Set([...core, ...config.technologySkills])) {
      if (!contract.skills.includes(name)) { warnings.push(`Unknown shared skill: ${name}`); continue; }
      const meta = metadata(read(local(source, `.agents/skills/${name}/SKILL.md`).target), name);
      put(`.agents/skills/${name}/SKILL.md`, sharedEntry(meta));
    }
  }
  const directory = local(root, '.agents/skills').target;
  if (existsSync(directory)) for (const item of readdirSync(directory, { withFileTypes: true })) {
    if (!item.isDirectory()) continue;
    let meta;
    try {
      meta = metadata(read(local(root, `.agents/skills/${item.name}/SKILL.md`).target), item.name);
    } catch (error) { warnings.push(`${item.name}: ${error.message}`); continue; }
    put(`.claude/skills/${item.name}/SKILL.md`, claudeEntry(meta));
  }
  const claudeDir = local(root, '.claude/skills').target;
  if (existsSync(claudeDir)) for (const item of readdirSync(claudeDir, { withFileTypes: true })) {
    if (item.isDirectory() && !existsSync(local(root, `.agents/skills/${item.name}/SKILL.md`).target)) warnings.push(`Orphan Claude entrypoint: ${item.name}; review removal manually.`);
  }
  const claude = local(root, 'CLAUDE.md').target;
  const old = existsSync(claude) ? read(claude) : '';
  if (!/^@AGENTS\.md\s*$/m.test(old)) {
    warnings.push('CLAUDE.md must import @AGENTS.md.');
    if (write) { writeFileSync(claude, '@AGENTS.md\n\n' + old); changed.push('CLAUDE.md'); }
  }
  return { warnings, changed };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, ...args] = process.argv.slice(2);
    let root = process.cwd(), source;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--root' && args[i + 1]) root = args[++i];
      else if (args[i] === '--source' && args[i + 1]) source = args[++i];
      else throw new Error('Use --root PATH and optional --source SNAPSHOT.');
    }
    if (!['check', 'sync', 'check-entrypoints'].includes(command)) throw new Error('Use check, sync or check-entrypoints.');
    const result = command === 'check' ? checkReadiness(root) : syncEntrypoints(root, { source, write: command === 'sync' });
    console.log(JSON.stringify(result, null, 2));
    // Structural readiness and drift are advisory. Runtime/usage failures still fail.
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
