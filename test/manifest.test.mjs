/**
 * 发布契约：**这个包能不能被别人装上并跑起来**，靠的是 package.json 里那几行声明。
 *
 * 为什么单独一个文件、而且值得钉：这几行的错法全都**不是本地报错**，而是"别人那边不工作"：
 *
 *   · 少了 `exports["./client"]` → client-modules 在**激活阶段**抛错，整个 profile 起不来；
 *   · 少了 `dsh.client.platform: "web"` → 产物不进 `__DSH_BOOT__`，插件静默缺席（界面毫无反应）；
 *   · 少了 `dsh.bundle.patch` → 作为 profile bundle 加载时直接报 "declares no dsh.bundle"；
 *   · 补丁层里的 `name` 不等于包名 → `dsh plugin add` 之后加载不到任何东西；
 *   · 不小心写回 `private: true` → `npm publish` 被拒（而这一步通常在发布当天才发现）；
 *   · `files` 白名单漏了产物或 README 里引用的图 → 装下来是空壳 / npm 页面上是断链；
 *   · `@deepseek-ai/dsh*` 的 peer 区间写成永远为真 → 宿主 preflight 的兼容闸门形同虚设。
 *
 * 最后一条尤其值得钉：宿主 preflight 不满足区间时是把整行**禁用**（静默缺席），
 * 所以区间既不能写太窄、也不能写成没有上界的空话。带宿主 semver 的精确判定在
 * `scripts/compat_status_bar.mjs`（那一条需要本机装有 DSH）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const REPO = resolve(import.meta.dirname, '..')
const manifest = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'))
const readme = readFileSync(join(REPO, 'README.md'), 'utf8')

test('可以发布：不是 private，且带 publishConfig（固定 registry 与 public）', () => {
  assert.notEqual(manifest.private, true, 'private: true 的包 publish 会被拒——独立包不该带着它')
  assert.equal(manifest.publishConfig?.access, 'public', '首次发布会决定可见性，写死 public')
  assert.match(
    String(manifest.publishConfig?.registry ?? ''),
    /^https:\/\/registry\.npmjs\.org\/?$/,
    '本机默认 registry 是镜像站，发布目标必须固定，不能交给环境',
  )
  assert.equal(typeof manifest.description, 'string')
  assert.ok(manifest.keywords?.length > 0, 'npm 搜索靠 keywords')
  assert.equal(manifest.license, 'MIT')
  assert.equal(typeof manifest.author, 'string')
})

test('仓库与版本信息指得着，且 README 里的版本号不会悄悄过期', () => {
  assert.equal(manifest.repository?.url, 'git+https://github.com/vianvio/dsh-plugin-status-bar.git')
  assert.equal(manifest.homepage, 'https://github.com/vianvio/dsh-plugin-status-bar#readme')
  assert.equal(manifest.bugs?.url, 'https://github.com/vianvio/dsh-plugin-status-bar/issues')
  assert.equal(manifest.dsh?.repo, 'vianvio/dsh-plugin-status-bar', 'dsh.repo 是插件管理器展示的来源')

  // 徽章是动态的，但正文里那句"当前版本 x.y.z"是手写的——写错一次，npm 页面就一直错着。
  const stated = /当前版本\s*`(?<version>\d+\.\d+\.\d+)`/u.exec(readme)?.groups?.version
  assert.equal(stated, manifest.version, 'README 正文里的版本必须等于 package.json 的版本')
  assert.equal(manifest.dsh?.version, manifest.version, 'dsh.version 与包版本应当同步')
})

test('客户端产物能被找到：dsh.client.platform + exports["./client"] 二者缺一不可', () => {
  assert.equal(manifest.dsh?.client?.platform, 'web', '少了它，客户端产物不会被发布到浏览器端')
  // client-modules 是从 exports["./client"] 解出**文件路径**再读字节的，所以这里必须是可解析的相对路径。
  const clientExport = manifest.exports?.['./client']
  assert.equal(clientExport, './client.js', 'DSH 按 exports["./client"] 找产物')
  assert.ok(existsSync(join(REPO, clientExport)), `exports["./client"] 指向的文件必须存在：${clientExport}`)
  assert.ok(
    manifest.dsh?.client?.inject?.includes('@deepseek-ai/dsh-client-ui-conversation'),
    '槽位属主（conversation.input.dock 由它声明）应当在 dsh.client.inject 里',
  )
})

test('作为 profile bundle 能被加载：dsh.bundle.patch 指向真实存在的补丁层', () => {
  const patch = manifest.dsh?.bundle?.patch
  assert.equal(patch, './cordis.patch.yml', 'profile 按这个字段找补丁层')
  assert.ok(existsSync(join(REPO, patch)), `补丁层文件必须存在：${patch}`)

  // 补丁里的 Loader 条目名必须就是这个包名，否则 `dsh plugin add` 之后加载不到东西。
  const yml = readFileSync(join(REPO, patch), 'utf8')
  assert.match(yml, new RegExp(`name:\\s*${manifest.name}\\b`), '补丁层里的 name 必须是包名')
  // dsh.id 是给人看的稳定标识（0.1.0 起就是 dsh-status-bar），与补丁条目 id 不要求同名——
  // 真正必须一致的是上面那条：补丁条目的 name == 包名。
  assert.equal(typeof manifest.dsh?.id, 'string')
})

test('宿主半与 exports["./client.js"] 都在，且 npm 的 files 白名单没漏掉产物', () => {
  assert.ok(existsSync(join(REPO, manifest.main)), `main 指向的文件必须存在：${manifest.main}`)
  assert.ok(existsSync(join(REPO, manifest.exports?.['./client.js'] ?? '')), './client.js 子路径也要能解析')

  // files 是"发布哪些文件"的白名单：漏了产物，装下来就是个空壳。
  for (const required of ['index.js', 'client.js', 'cordis.patch.yml', 'README.md', 'LICENSE', 'docs', 'scripts']) {
    assert.ok(manifest.files?.includes(required), `files 白名单里必须有 ${required}`)
  }

  // README 里引用了演示图，图不在包里的话 npm 页面上就是一条断链。
  // 只认**本仓的相对路径**：徽章那类外链（https://img.shields.io/…）不归这个包管。
  for (const asset of readme.matchAll(/\]\((?<path>[^)\s]+\.(?:png|jpg|jpeg|gif|svg|webp))\)/gu)) {
    const relative = asset.groups.path
    if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(relative)) continue
    assert.ok(existsSync(join(REPO, relative)), `README 引用的图必须存在：${relative}`)
    const shipped = manifest.files?.some((entry) => relative.startsWith(entry.replace(/\/$/u, '') + '/'))
    assert.ok(shipped, `README 引用的图必须在 files 白名单里，否则 npm 页面断链：${relative}`)
  }

  // 相对链接（docs/notes.md 这类）也要指得着，否则 GitHub 与 npm 上都是死链。
  for (const link of readme.matchAll(/\]\((?<path>(?!https?:|#)[^)\s]+\.(?:md|yml|js))\)/gu)) {
    const relative = link.groups.path
    assert.ok(existsSync(join(REPO, relative)), `README 里的相对链接必须存在：${relative}`)
    const shipped = manifest.files?.some((entry) => relative.startsWith(entry.replace(/\/$/u, '') + '/') || relative === entry)
    assert.ok(shipped, `README 里的相对链接必须在 files 白名单里，否则 npm 页面死链：${relative}`)
  }
})

test('@deepseek-ai/dsh* 的 peer 区间是带上下界的真闸门，不是空话', () => {
  const gate = Object.entries(manifest.peerDependencies ?? {}).filter(
    ([name]) => name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-'),
  )
  assert.ok(gate.length > 0, '宿主 preflight 只读 peerDependencies 里的 @deepseek-ai/dsh*，不写就等于放弃这道闸门')
  for (const [name, range] of gate) {
    assert.match(range, />=?/, `${name} 的区间需要下界`)
    assert.match(range, /</, `${name} 的区间需要上界——只写 >= 会把破坏性变更一起放过去`)
    assert.match(range, /<0\.\d+\.0-0/, `${name} 的上界要挡在下一个次版本的预发布之前（形如 <0.3.0-0）`)
  }
  assert.equal(manifest.peerDependencies?.['@deepseek-ai/cordis'] !== undefined, true, 'cordis 版本也一并声明')
})
