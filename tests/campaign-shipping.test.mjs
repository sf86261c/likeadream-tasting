import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import test from 'node:test'

const htmlPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html')
const html = (await readFile(htmlPath, 'utf8')).replace(/\r\n/g, '\n')
function extractFunction(name) {
  const start = html.indexOf(`function ${name}(`)
  assert.ok(start >= 0)
  const open = html.indexOf('{', start)
  let depth = 0
  for (let i = open; i < html.length; i++) {
    if (html[i] === '{') depth++
    if (html[i] === '}' && --depth === 0) return html.slice(start, i + 1)
  }
  assert.fail(`unterminated ${name}`)
}
const shippingSource = extractFunction('calculateTastingShipping')
const totalSource = extractFunction('calcTotal')
const runtimePath = join(dirname(htmlPath), 'tests', 'fixtures', 'campaign-runtime.js')
const runtimeSource = shippingSource + '\n' + totalSource + '\nvar islandCampaignNoticeShown = false;\n'
assert.equal((await readFile(runtimePath, 'utf8')).replace(/\r\n/g, '\n'), runtimeSource, 'coverage snapshot must match current HTML functions exactly')
const campaignNow = new Date('2026-10-02T04:00:00Z')
function policy(source = shippingSource) {
  const context = { Date }
  vm.runInNewContext(source + '\n' + totalSource + '\nvar islandCampaignNoticeShown = false;\n', context, {
    filename: source === shippingSource ? runtimePath : join(dirname(runtimePath), 'policy-mutant.js'),
  })
  return context.calculateTastingShipping
}
const shipping = policy()

test('campaign uses inclusive Taiwan dates and excludes neighboring instants', () => {
  for (const [date, expected] of [
    ['2026-09-30T15:59:59.999Z', false],
    ['2026-09-30T16:00:00.000Z', true],
    ['2026-10-02T04:00:00.000Z', true],
    ['2026-12-31T15:59:59.999Z', true],
    ['2026-12-31T16:00:00.000Z', false],
    ['2027-10-02T04:00:00.000Z', false],
  ]) assert.equal(shipping(2, false, false, new Date(date)).campaignApplied, expected, date)
})

test('two or three gift types qualify, one type retains ordinary delivery fees', () => {
  for (const count of [1, 2, 3]) {
    for (const island of [false, true]) {
      const result = shipping(count, false, island, campaignNow)
      assert.equal(result.shippingFee, count >= 2 ? (island ? 100 : 0) : (island ? 260 : 160))
      assert.equal(result.campaignApplied, count >= 2)
    }
  }
})

test('no selection and store pickup never accrue delivery fees or campaign notices', () => {
  for (const count of [0, 1, 2, 3]) {
    for (const island of [false, true]) {
      assert.equal(shipping(count, true, island, campaignNow).shippingFee, 0)
      assert.equal(shipping(count, true, island, campaignNow).campaignApplied, false)
    }
  }
  assert.equal(shipping(0, false, true, campaignNow).shippingFee, 0)
})

function runtime({ address = '台中市沙鹿區平等路52號', count = 2, pickup = false } = {}) {
  const plans = [300, 200, 350].slice(0, count).map(price => ({ getAttribute: () => String(price) }))
  const display = { innerHTML: '', offsetWidth: 1, classList: { remove() {}, add() {} } }
  Object.defineProperty(display, 'innerText', { get() { return this.innerHTML.replace(/<[^>]*>/g, '') } })
  const nodes = { cAddress: { value: address }, totalDisplay: display }
  const alerts = []
  class PreviewDate extends Date { constructor(...args) { super(...(args.length ? args : [campaignNow.getTime()])) } }
  const context = {
    Date: PreviewDate,
    islandCampaignNoticeShown: false,
    alert: message => alerts.push(message),
    document: {
      querySelectorAll: () => plans,
      querySelector: () => ({ value: pickup ? '門市取貨' : '宅配寄送' }),
      getElementById: id => nodes[id],
    },
  }
  vm.runInNewContext(runtimeSource, context, { filename: runtimePath })
  return { context, nodes, alerts, plans, display }
}

test('calcTotal reads actual choices and administrative island names, preserving product totals', () => {
  const examples = [
    ['台中市沙鹿區平等路52號', 0],
    ['新北市板橋區金門街1號', 0],
    ['桃園市中壢區馬祖新村1號', 0],
    ['澎湖縣馬公市1號', 100],
    ['金門縣金城鎮1號', 100],
    ['連江縣南竿鄉1號', 100],
    ['臺東縣綠島鄉1號', 100],
    ['臺東縣蘭嶼鄉1號', 100],
    ['屏東縣琉球鄉1號', 100],
    ['屏東縣小琉球1號', 100],
  ]
  for (const [address, fee] of examples) {
    const { context, display, alerts } = runtime({ address })
    const result = context.calcTotal()
    assert.equal(result.productTotal, 500, address)
    assert.equal(result.shippingFee, fee, address)
    assert.equal(result.finalTotal, 500 + fee, address)
    assert.match(display.innerHTML, new RegExp(`最終金額：\\$${500 + fee}`))
    assert.equal(alerts.length, fee === 100 ? 1 : 0, address)
  }
})

test('island popup is exact and appears once per qualifying transition', () => {
  const { context, nodes, alerts } = runtime({ address: '金門縣金城鎮1號' })
  context.calcTotal()
  nodes.cAddress.value += '2樓'
  context.calcTotal()
  assert.deepEqual(alerts, ['本活動僅限本島免運，離島配送需酌收100元差額'])
  nodes.cAddress.value = '台中市沙鹿區1號'
  assert.equal(context.calcTotal().shippingFee, 0)
  nodes.cAddress.value = '澎湖縣馬公市1號'
  context.calcTotal()
  assert.equal(alerts.length, 2)
})

test('calcTotal covers empty selections, ordinary shipping and pickup without island warnings', () => {
  for (const [count, pickup, expected] of [[0, false, 0], [1, false, 460], [1, true, 300], [3, true, 850], [3, false, 950]]) {
    const { context, alerts, display } = runtime({ count, pickup, address: count === 1 ? '台中市沙鹿區1號' : '金門縣金城鎮1號' })
    assert.equal(context.calcTotal().finalTotal, expected)
    const shown = display.innerHTML
    assert.equal(context.calcTotal().finalTotal, expected)
    assert.equal(display.innerHTML, shown)
    assert.equal(alerts.length, count === 3 && !pickup ? 1 : 0)
  }
})

test('property: all choice combinations, delivery modes and date boundaries preserve totals', () => {
  let cases = 0
  for (let mask = 0; mask < 8; mask++) {
    const prices = [300, 200, 350].filter((_, index) => mask & (1 << index))
    for (const pickup of [false, true]) {
      for (const island of [false, true]) {
        for (const active of [false, true]) {
          const date = active ? campaignNow : new Date('2027-01-01T00:00:00+08:00')
          const expected = prices.length === 0 || pickup ? 0 : active && prices.length >= 2 ? (island ? 100 : 0) : (island ? 260 : 160)
          const actual = shipping(prices.length, pickup, island, date).shippingFee
          assert.equal(actual, expected)
          assert.equal(prices.reduce((sum, price) => sum + price, 0) + actual, prices.reduce((sum, price) => sum + price, 0) + expected)
          cases++
        }
      }
    }
  }
  assert.equal(cases, 64)
})

test('critical policy mutations are detected by behavioral contracts', t => {
  const mutations = [
    ['two types excluded', 'planCount >= 2', 'planCount > 2', f => assert.equal(f(2, false, false, campaignNow).shippingFee, 0)],
    ['single type qualifies', 'planCount >= 2', 'planCount >= 1', f => assert.equal(f(1, false, false, campaignNow).shippingFee, 160)],
    ['island differential lost', 'isIsland ? 100 : 0', 'isIsland ? 0 : 0', f => assert.equal(f(2, false, true, campaignNow).shippingFee, 100)],
    ['opening instant excluded', 'timestamp >= Date.parse', 'timestamp > Date.parse', f => assert.equal(f(2, false, false, new Date('2026-10-01T00:00:00+08:00')).shippingFee, 0)],
    ['closing instant included', 'timestamp < Date.parse', 'timestamp <= Date.parse', f => assert.equal(f(2, false, false, new Date('2027-01-01T00:00:00+08:00')).shippingFee, 160)],
    ['pickup charged', 'if (isPickup)', 'if (false)', f => assert.equal(f(1, true, false, campaignNow).shippingFee, 0)],
  ]
  for (const [name, from, to, contract] of mutations) {
    assert.ok(shippingSource.includes(from))
    assert.throws(() => contract(policy(shippingSource.replace(from, to))), { name: 'AssertionError' }, name)
  }
  t.diagnostic('6 killed; 0 survived; 0 no-coverage; 0 timeouts; 0 errors')
})
